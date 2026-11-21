const ident = (name, label = 'identifier') => {
  if (typeof name !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw httpError(400, 'PGRST100', `Invalid ${label}: ${name}`)
  }
  return `"${name}"`
}

function httpError(status, code, message, details = null, hint = null) {
  const err = new Error(message)
  err.httpStatus = status
  err.pgCode = code
  err.details = details
  err.hint = hint
  return err
}

function splitTop(text, sep = ',') {
  const out = []
  let depth = 0
  let inQuote = false
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' && text[i - 1] !== '\\') inQuote = !inQuote
    else if (!inQuote) {
      if (ch === '(') depth++
      else if (ch === ')' && depth > 0) depth--
      else if (ch === sep && depth === 0) {
        out.push(text.slice(start, i))
        start = i + 1
      }
    }
  }
  out.push(text.slice(start))
  return out.map(s => s.trim()).filter(Boolean)
}

function castOf(colMeta) {
  if (!colMeta) return 'text'
  return colMeta.isArray ? `${colMeta.baseType}[]` : colMeta.udt
}

function bindValue(val, colMeta) {
  if (val === undefined || val === null) return null
  if (colMeta?.udt === 'jsonb' || colMeta?.udt === 'json') {
    return typeof val === 'string' ? val : JSON.stringify(val)
  }
  return val
}

function formatCell(val, dataTypeID) {
  if (val === null || val === undefined) return null
  // PostgreSQL date (OID 1082) ต้องคืน YYYY-MM-DD ตามรูปแบบ PostgREST
  if (dataTypeID === 1082 && val instanceof Date) return val.toISOString().slice(0, 10)
  if ((dataTypeID === 1114 || dataTypeID === 1184) && val instanceof Date) return val.toISOString()
  if (dataTypeID === 1700 && typeof val === 'string' && val !== '') {
    const n = Number(val)
    if (Number.isFinite(n)) return n
  }
  return val
}

function formatRows(result) {
  const fields = result.fields ?? []
  return result.rows.map(row => {
    const obj = {}
    for (const f of fields) obj[f.name] = formatCell(row[f.name], f.dataTypeID)
    return obj
  })
}

function parseInList(raw) {
  if (!raw.startsWith('(') || !raw.endsWith(')')) return []
  const inner = raw.slice(1, -1).trim()
  if (!inner) return []
  return splitTop(inner, ',').map(item => {
    if (item.startsWith('"') && item.endsWith('"') && item.length >= 2) {
      return item.slice(1, -1).replace(/\\"/g, '"')
    }
    return item
  })
}

function parseFilterExpr(colName, expr, tMeta, params, alias = 't') {
  const col = tMeta.columns.get(colName)
  if (!col) throw httpError(400, 'PGRST204', `Unknown column ${colName}`)
  const lhs = `${alias}.${ident(colName)}`

  let negate = false
  let rest = expr
  if (rest.startsWith('not.')) {
    negate = true
    rest = rest.slice(4)
  }

  let sql
  if (rest === 'is.null') {
    sql = `${lhs} IS NULL`
  } else if (rest === 'is.true' || rest === 'is.false') {
    sql = `${lhs} IS ${rest === 'is.true' ? 'TRUE' : 'FALSE'}`
  } else {
    const dot = rest.indexOf('.')
    if (dot < 0) throw httpError(400, 'PGRST100', `Invalid filter expression: ${expr}`)
    const op = rest.slice(0, dot)
    const rawVal = rest.slice(dot + 1)
    if (op === 'in') {
      const list = parseInList(rawVal)
      if (!list.length) sql = 'FALSE'
      else {
        params.push(list)
        sql = `${lhs} = ANY($${params.length}::${col.baseType}[])`
      }
    } else if (op === 'cs') {
      params.push(col.isArray ? parseInList(rawVal.replace(/^\{|\}$/g, s => s === '{' ? '(' : ')')) : rawVal)
      sql = `${lhs} @> $${params.length}::${castOf(col)}`
    } else {
      const map = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', like: 'LIKE', ilike: 'ILIKE' }
      const sqlOp = map[op]
      if (!sqlOp) throw httpError(400, 'PGRST100', `Unsupported operator ${op}`)
      const val = op === 'like' || op === 'ilike' ? rawVal.replace(/\*/g, '%') : rawVal
      params.push(val)
      sql = `${lhs} ${sqlOp} $${params.length}::${castOf(col)}`
    }
  }
  return negate ? `NOT (${sql})` : sql
}

function parseLogicalGroup(expr, tMeta, params, alias = 't') {
  if (!expr.startsWith('(') || !expr.endsWith(')')) throw httpError(400, 'PGRST100', `Invalid logical expression: ${expr}`)
  const inner = expr.slice(1, -1)
  const parts = splitTop(inner, ',')
  return parts.map(part => {
    if (part.startsWith('and(') || part.startsWith('and=(')) {
      const body = part.slice(part.indexOf('('))
      return `(${parseLogicalGroup(body, tMeta, params, alias).join(' AND ')})`
    }
    if (part.startsWith('or(') || part.startsWith('or=(')) {
      const body = part.slice(part.indexOf('('))
      return `(${parseLogicalGroup(body, tMeta, params, alias).join(' OR ')})`
    }
    const dot = part.indexOf('.')
    if (dot < 0) throw httpError(400, 'PGRST100', `Invalid logical item: ${part}`)
    return parseFilterExpr(part.slice(0, dot), part.slice(dot + 1), tMeta, params, alias)
  })
}

function buildWhere(searchParams, tMeta, params, alias = 't') {
  const reserved = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])
  const clauses = []
  for (const [key, value] of searchParams.entries()) {
    if (reserved.has(key) || key.includes('.')) continue
    if (key === 'or' || key === 'not.or') {
      const group = parseLogicalGroup(value, tMeta, params, alias)
      if (group.length) clauses.push(`${key.startsWith('not.') ? 'NOT ' : ''}(${group.join(' OR ')})`)
    } else if (key === 'and' || key === 'not.and') {
      const group = parseLogicalGroup(value, tMeta, params, alias)
      if (group.length) clauses.push(`${key.startsWith('not.') ? 'NOT ' : ''}(${group.join(' AND ')})`)
    } else {
      clauses.push(parseFilterExpr(key, value, tMeta, params, alias))
    }
  }
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
}

function buildSelect(selectStr, tableName, schema, searchParams, alias = 't') {
  const tMeta = schema.tables.get(tableName)
  if (!tMeta) throw httpError(404, 'PGRST205', `Unknown table ${tableName}`)
  const items = splitTop(selectStr || '*', ',')
  const cols = []

  for (const item of items) {
    if (item === '*') {
      for (const colName of tMeta.columns.keys()) cols.push(`${alias}.${ident(colName)}`)
      continue
    }
    const open = item.indexOf('(')
    if (open > 0 && item.endsWith(')')) {
      const rel = item.slice(0, open).replace(/!inner$/, '')
      const inner = item.slice(open + 1, -1)
      const relMeta = schema.tables.get(rel)
      if (!relMeta) throw httpError(400, 'PGRST200', `Unknown embedded relation ${rel}`)
      const innerCols = splitTop(inner, ',')
      const fkFrom = tMeta.fksFrom.find(f => f.table === rel)
      if (fkFrom) {
        const pairs = []
        for (const ic of innerCols) {
          if (ic === '*') {
            for (const c of relMeta.columns.keys()) pairs.push(`'${c}', r.${ident(c)}`)
          } else {
            if (!relMeta.columns.has(ic)) throw httpError(400, 'PGRST204', `Unknown column ${rel}.${ic}`)
            pairs.push(`'${ic}', r.${ident(ic)}`)
          }
        }
        cols.push(`(SELECT jsonb_build_object(${pairs.join(', ')}) FROM public.${ident(rel)} r WHERE r.${ident(fkFrom.remoteCol)} = ${alias}.${ident(fkFrom.localCol)} LIMIT 1) AS ${ident(rel)}`)
        continue
      }
      const fkTo = tMeta.fksTo.find(f => f.table === rel)
      if (fkTo) {
        const subCols = innerCols.flatMap(ic => {
          if (ic === '*') return [...relMeta.columns.keys()].map(c => `r.${ident(c)}`)
          if (!relMeta.columns.has(ic)) throw httpError(400, 'PGRST204', `Unknown column ${rel}.${ic}`)
          return [`r.${ident(ic)}`]
        })
        const subLimit = Number(searchParams.get(`${rel}.limit`))
        const limitSql = Number.isInteger(subLimit) && subLimit >= 0 ? ` LIMIT ${subLimit}` : ''
        cols.push(`(SELECT coalesce(jsonb_agg(sub.*), '[]'::jsonb) FROM (SELECT ${subCols.join(', ')} FROM public.${ident(rel)} r WHERE r.${ident(fkTo.remoteCol)} = ${alias}.${ident(fkTo.localCol)}${limitSql}) sub) AS ${ident(rel)}`)
        continue
      }
      throw httpError(400, 'PGRST200', `No foreign key between ${tableName} and ${rel}`)
    }
    if (!tMeta.columns.has(item)) throw httpError(400, 'PGRST204', `Unknown column ${tableName}.${item}`)
    cols.push(`${alias}.${ident(item)}`)
  }
  return cols.join(', ')
}

function buildOrder(orderStr, tMeta, alias = 't') {
  if (!orderStr) return ''
  const parts = splitTop(orderStr, ',').map(term => {
    const tokens = term.split('.')
    const col = tokens[0]
    if (!tMeta.columns.has(col)) throw httpError(400, 'PGRST204', `Unknown order column ${col}`)
    let dir = 'ASC'
    let nulls = ''
    for (const tok of tokens.slice(1)) {
      if (tok === 'asc') dir = 'ASC'
      else if (tok === 'desc') dir = 'DESC'
      else if (tok === 'nullsfirst') nulls = ' NULLS FIRST'
      else if (tok === 'nullslast') nulls = ' NULLS LAST'
    }
    return `${alias}.${ident(col)} ${dir}${nulls}`
  })
  return parts.length ? `ORDER BY ${parts.join(', ')}` : ''
}

function mapPgError(err) {
  if (err.httpStatus) {
    return { status: err.httpStatus, body: { code: err.pgCode, details: err.details, hint: err.hint, message: err.message } }
  }
  const code = err.code ?? 'P0001'
  let status = 400
  if (code === '42501') status = 403
  else if (code === '23505' || code === '23503') status = 409
  else if (code === 'P0002') status = 404
  return { status, body: { code, details: err.detail ?? null, hint: err.hint ?? null, message: err.message } }
}

function singleObjectCheck(rows, acceptHeader) {
  if (!acceptHeader?.includes('application/vnd.pgrst.object+json')) return { single: false, data: rows }
  if (rows.length !== 1) {
    throw httpError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned', `The result contains ${rows.length} rows`)
  }
  return { single: true, data: rows[0] }
}

export async function handleRest({ db, method, path, url, headers, bodyText }) {
  const uid = headers['x-qa-uid'] ?? null
  const accept = headers.accept ?? ''
  const prefer = headers.prefer ?? ''
  const wantSingle = accept.includes('application/vnd.pgrst.object+json')
  const wantCount = prefer.includes('count=exact')
  const wantRep = prefer.includes('return=representation') || url.searchParams.has('select')

  try {
    if (path.startsWith('rpc/')) {
      const fnName = path.slice(4)
      if (method !== 'POST') throw httpError(405, 'PGRST100', 'Method not allowed')
      const argsObj = bodyText ? JSON.parse(bodyText) : {}
      const out = await db.withTx(uid, async (pg, schema) => {
        const candidates = schema.rpcs.get(fnName)
        if (!candidates?.length) throw httpError(404, 'PGRST202', `Could not find function public.${fnName}`)
        const keys = Object.keys(argsObj)
        const fn = candidates.find(c => keys.every(k => c.args.some(a => a.name === k))) ?? candidates[0]
        const paramSql = []
        const params = []
        for (const k of keys) {
          const argDef = fn.args.find(a => a.name === k)
          if (!argDef) throw httpError(400, 'PGRST202', `Unknown parameter ${k} for ${fnName}`)
          let val = argsObj[k]
          if (val !== null && val !== undefined && (argDef.type === 'jsonb' || argDef.type === 'json')) {
            val = typeof val === 'string' ? val : JSON.stringify(val)
          }
          params.push(val ?? null)
          paramSql.push(`${ident(k)} => $${params.length}::${argDef.type}`)
        }
        const callExpr = `public.${ident(fnName)}(${paramSql.join(', ')})`
        if (fn.returnsVoid) {
          await pg.query(`SELECT ${callExpr}`, params)
          return { status: 204, body: null }
        }
        if (fn.returnsSet) {
          const res = await pg.query(`SELECT * FROM ${callExpr}`, params)
          const rows = formatRows(res)
          if (wantSingle) {
            const checked = singleObjectCheck(rows, accept)
            return { status: 200, body: checked.data }
          }
          return { status: 200, body: rows }
        }
        const res = await pg.query(`SELECT ${callExpr} AS _val`, params)
        const val = formatCell(res.rows[0]?._val, res.fields[0]?.dataTypeID)
        return { status: 200, body: val }
      })
      return { status: out.status, headers: {}, body: out.body }
    }

    const tableName = path
    if (!db.schema.tables.has(tableName)) throw httpError(404, 'PGRST205', `Could not find table public.${tableName}`)

    if (method === 'GET' || method === 'HEAD') {
      const out = await db.withTx(uid, async (pg, schema) => {
        const tMeta = schema.tables.get(tableName)
        const params = []
        const whereSql = buildWhere(url.searchParams, tMeta, params, 't')
        let offset = Number(url.searchParams.get('offset') ?? 0)
        let limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : null
        const range = headers.range
        if (range && limit === null) {
          const m = /^(?:items=)?(\d+)-(\d+)$/.exec(range)
          if (m) {
            offset = Number(m[1])
            limit = Number(m[2]) - offset + 1
          }
        }
        let total = null
        if (wantCount || method === 'HEAD') {
          const cnt = await pg.query(`SELECT count(*)::int AS n FROM public.${ident(tableName)} t ${whereSql}`, params)
          total = cnt.rows[0]?.n ?? 0
        }
        if (method === 'HEAD') {
          const rangeHdr = total > 0 ? `0-${total - 1}/${total}` : '*/0'
          return { status: 200, headers: { 'Content-Range': rangeHdr }, body: null }
        }
        const selectSql = buildSelect(url.searchParams.get('select'), tableName, schema, url.searchParams, 't')
        const orderSql = buildOrder(url.searchParams.get('order'), tMeta, 't')
        const limitSql = limit !== null && Number.isFinite(limit) ? ` LIMIT ${Math.max(0, Math.floor(limit))}` : ''
        const offsetSql = Number.isFinite(offset) && offset > 0 ? ` OFFSET ${Math.floor(offset)}` : ''
        const sql = `SELECT ${selectSql} FROM public.${ident(tableName)} t ${whereSql} ${orderSql}${limitSql}${offsetSql}`
        const res = await pg.query(sql, params)
        const rows = formatRows(res)
        const checked = singleObjectCheck(rows, accept)
        const resHeaders = {}
        if (total !== null) {
          resHeaders['Content-Range'] = rows.length ? `${offset}-${offset + rows.length - 1}/${total}` : `*/${total}`
        }
        return { status: 200, headers: resHeaders, body: checked.data }
      })
      return out
    }

    if (method === 'POST') {
      const payload = bodyText ? JSON.parse(bodyText) : {}
      const list = Array.isArray(payload) ? payload : [payload]
      if (!list.length) return { status: 201, headers: {}, body: wantRep ? [] : null }
      return await db.withTx(uid, async (pg, schema) => {
        const tMeta = schema.tables.get(tableName)
        const colsParam = url.searchParams.get('columns')
        const colNames = colsParam
          ? splitTop(colsParam, ',').map(c => c.replace(/^"|"$/g, ''))
          : [...new Set(list.flatMap(r => Object.keys(r)))]
        for (const c of colNames) if (!tMeta.columns.has(c)) throw httpError(400, 'PGRST204', `Unknown column ${c}`)
        const params = []
        const valueRows = list.map(row => {
          const placeholders = colNames.map(c => {
            const colMeta = tMeta.columns.get(c)
            params.push(bindValue(row[c], colMeta))
            return `$${params.length}::${castOf(colMeta)}`
          })
          return `(${placeholders.join(', ')})`
        })
        let conflictSql = ''
        const onConflict = url.searchParams.get('on_conflict')
        if (onConflict && prefer.includes('resolution=merge-duplicates')) {
          const conflictCols = splitTop(onConflict, ',')
          for (const c of conflictCols) if (!tMeta.columns.has(c)) throw httpError(400, 'PGRST204', `Unknown conflict column ${c}`)
          const updates = colNames.filter(c => !conflictCols.includes(c))
          conflictSql = updates.length
            ? ` ON CONFLICT (${conflictCols.map(c => ident(c)).join(', ')}) DO UPDATE SET ${updates.map(c => `${ident(c)} = EXCLUDED.${ident(c)}`).join(', ')}`
            : ` ON CONFLICT (${conflictCols.map(c => ident(c)).join(', ')}) DO NOTHING`
        } else if (prefer.includes('resolution=ignore-duplicates')) {
          conflictSql = ' ON CONFLICT DO NOTHING'
        }
        const retSql = wantRep ? ` RETURNING ${buildSelect(url.searchParams.get('select'), tableName, schema, url.searchParams, ident(tableName))}` : ''
        const sql = `INSERT INTO public.${ident(tableName)} (${colNames.map(c => ident(c)).join(', ')}) VALUES ${valueRows.join(', ')}${conflictSql}${retSql}`
        const res = await pg.query(sql, params)
        if (!wantRep) return { status: 201, headers: {}, body: null }
        const rows = formatRows(res)
        return { status: 201, headers: {}, body: singleObjectCheck(rows, accept).data }
      })
    }

    if (method === 'PATCH') {
      const payload = bodyText ? JSON.parse(bodyText) : {}
      const keys = Object.keys(payload)
      if (!keys.length) throw httpError(400, 'PGRST100', 'Empty PATCH body')
      return await db.withTx(uid, async (pg, schema) => {
        const tMeta = schema.tables.get(tableName)
        const params = []
        const sets = keys.map(k => {
          const colMeta = tMeta.columns.get(k)
          if (!colMeta) throw httpError(400, 'PGRST204', `Unknown column ${k}`)
          params.push(bindValue(payload[k], colMeta))
          return `${ident(k)} = $${params.length}::${castOf(colMeta)}`
        })
        const whereSql = buildWhere(url.searchParams, tMeta, params, 't')
        const retSql = wantRep ? ` RETURNING ${buildSelect(url.searchParams.get('select'), tableName, schema, url.searchParams, 't')}` : ''
        const sql = `UPDATE public.${ident(tableName)} t SET ${sets.join(', ')} ${whereSql}${retSql}`
        const res = await pg.query(sql, params)
        if (wantRep) {
          const rows = formatRows(res)
          return { status: 200, headers: {}, body: singleObjectCheck(rows, accept).data }
        }
        if (wantSingle && res.affectedRows !== 1) throw httpError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned')
        return { status: 204, headers: {}, body: null }
      })
    }

    if (method === 'DELETE') {
      return await db.withTx(uid, async (pg, schema) => {
        const tMeta = schema.tables.get(tableName)
        const params = []
        const whereSql = buildWhere(url.searchParams, tMeta, params, 't')
        const retSql = wantRep ? ` RETURNING ${buildSelect(url.searchParams.get('select'), tableName, schema, url.searchParams, 't')}` : ''
        const sql = `DELETE FROM public.${ident(tableName)} t ${whereSql}${retSql}`
        const res = await pg.query(sql, params)
        if (wantRep) {
          const rows = formatRows(res)
          return { status: 200, headers: {}, body: singleObjectCheck(rows, accept).data }
        }
        if (wantSingle && res.affectedRows !== 1) throw httpError(406, 'PGRST116', 'JSON object requested, multiple (or no) rows returned')
        return { status: 204, headers: {}, body: null }
      })
    }

    throw httpError(405, 'PGRST100', `Unsupported method ${method}`)
  } catch (err) {
    const mapped = mapPgError(err)
    return { status: mapped.status, headers: {}, body: mapped.body }
  }
}

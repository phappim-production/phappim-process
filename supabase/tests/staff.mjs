// ชื่อพนักงานสำหรับไทม์ไลน์รายละเอียดงาน (S8) · เปิดเฉพาะชื่อ ไม่เปิด profile ทั้งแถว

export async function staffTests({ db, ok, as }) {
  const U = {
    owner: '00000000-0000-0000-0000-000000000001', nobody: '00000000-0000-0000-0000-000000000003',
    off: '00000000-0000-0000-0000-000000000004', prod: '00000000-0000-0000-0000-000000000013',
  }
  const names = async uid => (await as(uid, () => db.query('select * from public.staff_names()'))).rows
  const reject = async (name, uid) => {
    try { await names(uid); ok(name, false, 'ควรถูกปฏิเสธแต่ผ่าน') } catch (e) { ok(name, true, e.message.split('\n')[0]) }
  }

  const rows = await names(U.prod)
  const total = (await db.query('select count(*)::int n from public.profiles')).rows[0].n
  ok('ชื่อพนักงาน: ฝ่ายผลิตเห็นชื่อทุกคน (ใช้แสดงผู้กดในไทม์ไลน์)', rows.length === total && rows.some(r => r.user_id === U.owner && r.name === 'เจ้าของ'),
    `${rows.length}/${total}`)
  ok('ชื่อพนักงาน: คืนแค่ user_id + ชื่อ ไม่มีบทบาทหรือสถานะบัญชี', Object.keys(rows[0]).sort().join(',') === 'name,user_id')
  const direct = (await as(U.prod, () => db.query('select count(*)::int n from public.profiles'))).rows[0].n
  ok('ชื่อพนักงาน: อ่านตาราง profiles ตรงยังเห็นแค่ของตัวเอง', direct === 1, `${direct} แถว`)
  await reject('ชื่อพนักงาน: ผู้ใช้ที่ไม่มีบทบาทเรียกไม่ได้', U.nobody)
  await reject('ชื่อพนักงาน: บัญชีที่ถูกปิดเรียกไม่ได้', U.off)
  try {
    await db.exec('set role anon')
    await db.query('select * from public.staff_names()')
    ok('ชื่อพนักงาน: คนไม่ล็อกอินเรียกไม่ได้', false, 'ควรถูกปฏิเสธแต่ผ่าน')
  } catch (e) {
    ok('ชื่อพนักงาน: คนไม่ล็อกอินเรียกไม่ได้', /permission denied/.test(e.message), e.message.split('\n')[0])
  } finally {
    await db.exec('reset role')
  }
}

import { readFileSync } from 'node:fs'
const html = readFileSync(new URL('../../production-confirmation.html', import.meta.url),'utf8')
const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1])
const js=scripts.find(s=>s.includes('function takeInbox'))
export function boot(search=''){
  const store=new Map()
  const el=()=>{ const e={ innerHTML:'', textContent:'', style:{}, dataset:{}, classList:{add(){},remove(){},toggle(){},contains(){return false}}, addEventListener(){}, querySelector(){return null}, querySelectorAll(){return []}, focus(){}, scrollIntoView(){}, before(){}, appendChild(){}, setAttribute(){}, click(){}, remove(){}, tHead:{offsetHeight:0}, tBodies:[{offsetHeight:0}], offsetHeight:100, parentNode:{insertBefore(){}} }; return e }
  const els=new Map()
  const document={ querySelector:s=>{ if(!els.has(s)) els.set(s,el()); return els.get(s)}, getElementById:()=>el(), createElement:()=>el(), addEventListener(){}, body:{classList:{contains:()=>false,toggle(){},add(){},remove(){}},appendChild(){}}, head:{appendChild(){}}, title:'', visibilityState:'visible' }
  const g={ document, localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},
    location:{search,pathname:'/confirmation',hash:'',protocol:'https:'}, history:{replaceState(){}}, scrollY:0, scrollTo(){}, addEventListener(){},
    CSS:{escape:s=>s}, alerts:[], confirmRet:true, toastMsgs:[], window:{open:()=>({})}, Image:class{}, URLSearchParams, setTimeout:()=>0, clearTimeout(){} }
  const fn=new Function(...Object.keys(g),'alert','confirm', js+`
;return { get state(){return state}, set state(v){state=v}, scope, totalQty, validate, renderDoc, saveToSystem, loadData, startOver, coRefs, coDocHTML, valText, allFields, visible, takeNew, takeInbox, revising, changedLabels, PRODUCTS, setViewOnly(x){viewOnly=x}, rerender, fieldIssue, jobSnapshot, shrunk, fieldHTML, HEADER };`)
  const api=fn(...Object.values(g), m=>g.alerts.push(m), ()=>g.confirmRet)
  return { api, g, store, document, els }
}

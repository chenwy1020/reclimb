export const APPEARANCE_KEY='reclimb.ui.appearance.v1';
export interface Appearance {mode:'system'|'light'|'dark';fontSize:number;lineHeight:number;readerPercent:number}
export const DEFAULT_APPEARANCE:Appearance={mode:'system',fontSize:16,lineHeight:1.9,readerPercent:40};
const bound=(value:unknown,base:number,min:number,max:number)=>typeof value==='number'&&Number.isFinite(value)?Math.max(min,Math.min(max,value)):base;
export function normalizeAppearance(value:unknown):Appearance{
 const v=(value&&typeof value==='object'?value:{}) as Partial<Appearance>;
 return {mode:v.mode==='dark'||v.mode==='light'?v.mode:'system',fontSize:Math.round(bound(v.fontSize,16,14,24)),lineHeight:Math.round(bound(v.lineHeight,1.9,1.4,2.4)*10)/10,readerPercent:Math.round(bound(v.readerPercent,40,30,65))};
}
export function readAppearance(storage?:Pick<Storage,'getItem'>):Appearance{try{return normalizeAppearance(JSON.parse(storage?.getItem(APPEARANCE_KEY)||'null'))}catch{return {...DEFAULT_APPEARANCE}}}
export const resolveTheme=(mode:Appearance['mode'],dark:boolean)=>mode==='system'?(dark?'dark':'light'):mode;

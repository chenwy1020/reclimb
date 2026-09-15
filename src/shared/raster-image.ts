import {z} from 'zod';
export const MAX_IMAGE_BYTES=6*1024*1024;
export const MAX_IMAGES_BYTES=16*1024*1024;
const MAX_PIXELS=20_000_000;
/** Inspect inert raster headers before any decoder allocation. Never accept URLs or SVG. */
export function rasterInfo(bytes:Uint8Array):{mime:'image/png'|'image/jpeg';width:number;height:number}{
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let width=0,height=0,mime:'image/png'|'image/jpeg';
 if(bytes.length>=33&&[137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)&&view.getUint32(8)===13&&String.fromCharCode(...bytes.slice(12,16))==='IHDR'){
  mime='image/png';width=view.getUint32(16);height=view.getUint32(20);
 }else if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216){
  mime='image/jpeg';let at=2;
  while(at+3<bytes.length){
   if(bytes[at++]!==255)break;while(bytes[at]===255)at++;const marker=bytes[at++];
   if(marker===217||marker===218)break;
   if(marker===1||(marker>=208&&marker<=215))continue;
   if(at+2>bytes.length)break;const length=view.getUint16(at);if(length<2||at+length>bytes.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8){height=view.getUint16(at+3);width=view.getUint16(at+5);break;}
   at+=length;
  }
 }else throw new Error('请选择 PNG 或 JPEG 图片；其他格式请先在 iPad 中截图。');
 if(width<1||height<1||width>12000||height>12000||width*height>MAX_PIXELS)throw new Error('图片无法读取或分辨率过大，请使用不超过 2000 万像素的截图。');
 return{mime,width,height};
}
export function imageDataInfo(dataUrl:string){
 if(dataUrl.length>MAX_IMAGE_BYTES*4/3+32)throw new Error('每张图片不能超过 6 MB，请分次截图。');
 const comma=dataUrl.indexOf(','),prefix=dataUrl.slice(0,comma),encoded=dataUrl.slice(comma+1);
 if(!['data:image/png;base64','data:image/jpeg;base64'].includes(prefix)||!encoded.length||encoded.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded))throw new Error('图片格式无效，请选择 PNG 或 JPEG。');
 let binary:string;try{binary=atob(encoded);}catch{throw new Error('图片数据不完整。');}
 if(binary.length>MAX_IMAGE_BYTES)throw new Error('每张图片不能超过 6 MB。');
 const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),info=rasterInfo(bytes);
 if(prefix!=='data:'+info.mime+';base64')throw new Error('图片内容与格式不一致。');
 return{...info,bytes};
}
export const rasterImageSchema=z.object({dataUrl:z.string().max(MAX_IMAGE_BYTES*4/3+32),width:z.number().int().positive().max(12000),height:z.number().int().positive().max(12000)}).strict().superRefine((value,ctx)=>{
 try{const info=imageDataInfo(value.dataUrl);if(info.width!==value.width||info.height!==value.height)throw new Error('图片尺寸与原图不一致。');}catch(error){ctx.addIssue({code:'custom',message:(error as Error).message});}
});

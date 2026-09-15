import type {InkPage} from './handwriting';
/** Keep a visible low-pressure line without changing the original pressure. */
export const inkLineWidth=(width:number,a:number,b=a)=>width*(.75+.5*(a+b)/2);
/** Data is validated on import; build inert SVG without text, links, scripts or foreignObject. */
export function inkPageSvg(page:InkPage):string {
 if(page.image)return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+page.image.width+' '+page.image.height+'"><image width="100%" height="100%" href="'+page.image.dataUrl+'"/></svg>';
 const segments=page.strokes.map(stroke=>{
  const points=stroke.points;
  if(points.length===1){const p=points[0];return '<circle cx="'+(p.x*768).toFixed(2)+'" cy="'+(p.y*1024).toFixed(2)+'" r="'+(stroke.width/2).toFixed(2)+'" fill="'+stroke.color+'"/>';}
  return points.slice(1).map((b,i)=>{const a=points[i];return '<path d="M '+(a.x*768).toFixed(2)+' '+(a.y*1024).toFixed(2)+' L '+(b.x*768).toFixed(2)+' '+(b.y*1024).toFixed(2)+'" fill="none" stroke="'+stroke.color+'" stroke-width="'+inkLineWidth(stroke.width,a.pressure,b.pressure).toFixed(2)+'" stroke-linecap="round"/>';}).join('');
 }).join('');
 return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 768 1024"><rect width="768" height="1024" fill="white"/>'+segments+'</svg>';
}
export const inkPageDataUrl=(page:InkPage)=>page.image?.dataUrl??'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(inkPageSvg(page));

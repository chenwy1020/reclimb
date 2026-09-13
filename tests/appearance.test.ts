import {describe,it,expect} from 'vitest';
import {normalizeAppearance,resolveTheme,DEFAULT_APPEARANCE,readAppearance,APPEARANCE_KEY} from '../src/renderer/appearance-state';
describe('local reading appearance',()=>{
 it('bounds corrupt settings and ignores unrelated fields',()=>{expect(normalizeAppearance({mode:'evil',fontSize:999,lineHeight:0,readerPercent:99,apiKey:'secret'})).toEqual({...DEFAULT_APPEARANCE,fontSize:24,lineHeight:1.4,readerPercent:65});expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);});
 it('follows the system only in system mode',()=>{expect(resolveTheme('system',true)).toBe('dark');expect(resolveTheme('light',true)).toBe('light');expect(resolveTheme('dark',false)).toBe('dark');});
 it('reads only the separate local UI preference and tolerates damaged storage',()=>{expect(readAppearance({getItem:key=>key===APPEARANCE_KEY?'bad':null})).toEqual(DEFAULT_APPEARANCE);expect(readAppearance({getItem:()=>JSON.stringify({mode:'dark',fontSize:18})})).toMatchObject({mode:'dark',fontSize:18});});
});

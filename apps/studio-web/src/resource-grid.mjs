/** Produce a complete grid without guessing partial frames. */
export function gridFrames(width,height,columns,rows,duration){
 if(![width,height,columns,rows,duration].every(Number.isSafeInteger)||width<1||height<1||columns<1||rows<1||columns*rows>120||width%columns||height%rows||duration<20||duration>60000)throw new Error('Проверь сетку: размеры должны делиться без остатка, максимум 120 кадров, время 20–60000 мс.');
 const frameWidth=width/columns,frameHeight=height/rows,frames=[];
 for(let y=0;y<rows;y++)for(let x=0;x<columns;x++)frames.push({x:x*frameWidth,y:y*frameHeight,width:frameWidth,height:frameHeight,duration_ms:duration});
 return frames;
}

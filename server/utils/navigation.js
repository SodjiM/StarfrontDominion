const {computePathBresenham} = require('./path');
const SIZE=5000;
function validPoint(p) { return p && Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y) && p.x>=0 && p.y>=0 && p.x<SIZE && p.y<SIZE; }
function occupancy(objects, shipId) {
    // Ships and structures occupy their tile; celestial bodies occupy their disk.
    const tiles=new Set(), disks=[];
    for(const o of objects) {
        if(Number(o.id)===Number(shipId)) continue;
        const radius=['star','sun','planet','moon','black-hole'].includes(o.type)?Math.max(0,Number(o.radius)||0):0;
        if(radius>0) disks.push({x:o.x,y:o.y,radius}); else tiles.add(`${o.x},${o.y}`);
    }
    return p=>!validPoint(p)||tiles.has(`${p.x},${p.y}`)||disks.some(o=>Math.hypot(p.x-o.x,p.y-o.y)<=o.radius);
}
function canStep(a,b,blocked) {
    const dx=Math.abs(a.x-b.x),dy=Math.abs(a.y-b.y);
    return dx<=1 && dy<=1 && (dx+dy)>0 && !blocked(b) && !(dx && dy && (blocked({x:a.x,y:b.y})||blocked({x:b.x,y:a.y})));
}
class Heap {
 constructor(){this.a=[];} push(n){let i=this.a.length;this.a.push(n);while(i){const p=(i-1)>>1;if(this.a[p].f<=n.f)break;this.a[i]=this.a[p];i=p;}this.a[i]=n;}
 pop(){const first=this.a[0],last=this.a.pop();if(this.a.length){let i=0;while(i*2+1<this.a.length){let c=i*2+1;if(c+1<this.a.length&&this.a[c+1].f<this.a[c].f)c++;if(this.a[c].f>=last.f)break;this.a[i]=this.a[c];i=c;}this.a[i]=last;}return first;}
}
function findPath(start,end,blocked,limit=40000) {
 if(!validPoint(start)||!validPoint(end)||blocked(end)) return null;
 const line=computePathBresenham(start.x,start.y,end.x,end.y);
 if(line.slice(1).every((p,i)=>canStep(line[i],p,blocked)))return line;
 const h=p=>Math.max(Math.abs(end.x-p.x),Math.abs(end.y-p.y));
 const key=p=>p.y*SIZE+p.x;const open=new Heap(),best=new Map();
 const first={...start,g:0,f:h(start),parent:null};open.push(first);best.set(key(first),0);
 let visited=0;
 while(open.a.length && visited++<limit){const n=open.pop();if(n.g!==best.get(key(n)))continue;
  if(n.x===end.x&&n.y===end.y){const path=[];for(let p=n;p;p=p.parent)path.push({x:p.x,y:p.y});return path.reverse();}
  for(const [dx,dy] of [[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[-1,-1],[1,-1]]){
   const p={x:n.x+dx,y:n.y+dy};if(!canStep(n,p,blocked))continue;const g=n.g+1,k=key(p);if(g>=(best.get(k)??Infinity))continue;best.set(k,g);open.push({...p,g,f:g+h(p),parent:n});
  }
 }
 return null;
}
function geometry(points) {
 if(!Array.isArray(points)||points.length<2||points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw new Error('invalid_lane_geometry');
 const acc=[0];for(let i=1;i<points.length;i++)acc.push(acc.at(-1)+Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y));
 const total=acc.at(-1);if(total<=0)throw new Error('invalid_lane_geometry');return {points,acc,total};
}
function pointAt(g,s) {s=Math.max(0,Math.min(g.total,s));let i=0;while(i<g.points.length-2&&g.acc[i+1]<s)i++;const a=g.points[i],b=g.points[i+1],t=(s-g.acc[i])/Math.max(1e-9,g.acc[i+1]-g.acc[i]);return {x:Math.round(a.x+(b.x-a.x)*t),y:Math.round(a.y+(b.y-a.y)*t)};}
function advance(start,end,budget) {const used=Math.min(Math.abs(end-start),Math.max(0,budget));return {position:start+Math.sign(end-start)*used,used,arrived:used>=Math.abs(end-start)};}
module.exports={validPoint,occupancy,canStep,findPath,geometry,pointAt,advance};

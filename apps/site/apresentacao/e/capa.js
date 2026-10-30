const c=document.getElementById('c'),g=c.getContext('2d');let W,H;const P=[],Q=[];
function rs(){W=c.width=innerWidth;H=c.height=innerHeight}rs();addEventListener('resize',rs);
for(let i=0;i<110;i++)P.push({x:.5+Math.random()*.5,y:Math.random(),vx:(Math.random()-.5)*.0005,vy:(Math.random()-.5)*.0005,r:Math.random()*2.2+1,h:Math.random()<.12});
function tick(){g.clearRect(0,0,W,H);
for(const p of P){p.x+=p.vx;p.y+=p.vy;if(p.x<.48||p.x>1)p.vx*=-1;if(p.y<0||p.y>1)p.vy*=-1}
const L=[];for(let i=0;i<P.length;i++)for(let j=i+1;j<P.length;j++){const a=P[i],b=P[j],dx=(a.x-b.x)*W,dy=(a.y-b.y)*H,d=Math.hypot(dx,dy);if(d<190){L.push([a,b]);g.strokeStyle='rgba(60,196,179,'+(.3*(1-d/190))+')';g.lineWidth=1.2;g.beginPath();g.moveTo(a.x*W,a.y*H);g.lineTo(b.x*W,b.y*H);g.stroke()}}
if(Math.random()<.08&&L.length)Q.push({l:L[Math.floor(Math.random()*L.length)],t:0});
for(let k=Q.length-1;k>=0;k--){const q=Q[k];q.t+=.02;if(q.t>1){Q.splice(k,1);continue}const[a,b]=q.l,x=(a.x+(b.x-a.x)*q.t)*W,y=(a.y+(b.y-a.y)*q.t)*H;g.fillStyle='rgba(180,255,244,.95)';g.beginPath();g.arc(x,y,3,0,7);g.fill()}
for(const p of P){if(p.h){g.fillStyle='rgba(60,196,179,.18)';g.beginPath();g.arc(p.x*W,p.y*H,p.r*6,0,7);g.fill()}g.fillStyle=p.h?'#9df0e4':'rgba(98,211,196,.8)';g.beginPath();g.arc(p.x*W,p.y*H,p.h?p.r*1.8:p.r,0,7);g.fill()}
requestAnimationFrame(tick)}tick();

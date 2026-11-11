/* Supabase shared database adapter. */
(function(){
  const a=window.__attendance, gate=document.getElementById('authGate'), status=document.getElementById('cloudStatus');
  let supa=null, ready=false, base={staff:[],records:{},leaves:[]}, queue=Promise.resolve(), refreshTimer;
  let cached=null;try{cached=JSON.parse(localStorage.getItem('attendance-app-v1')||'null')}catch{}
  const snapshot=()=>JSON.parse(JSON.stringify(a.db));
  const same=(x,y)=>JSON.stringify(x)===JSON.stringify(y);
  const demo=[['E001','张明','产品部'],['E002','李娜','设计部'],['E003','王磊','技术部'],['E004','陈佳','市场部'],['E005','刘洋','技术部']];
  const hasLegacy=!!cached&&((cached.records&&Object.keys(cached.records).length>0)||(cached.leaves&&cached.leaves.length>0)||!same(cached.staff||[],demo.map(([id,name,dept])=>({id,name,dept}))));
  const mark=(s,c='')=>{status.textContent=s;status.className='cloud-status '+c};
  async function load(){
    mark('正在同步…');
    const member=await supa.from('team_members').select('email').maybeSingle();if(member.error)throw member.error;if(!member.data)throw new Error('此邮箱不在团队成员名单中，请管理员先在 team_members 表添加该邮箱。');
    const [s,r,l]=await Promise.all([supa.from('staff').select('*').order('name'),supa.from('attendance_records').select('*').order('work_date'),supa.from('leave_requests').select('*').order('created_at')]);
    for(const q of [s,r,l])if(q.error)throw q.error;
    if(!s.data.length&&!r.data.length&&!l.data.length&&hasLegacy){a.db=cached;base={staff:[],records:{},leaves:[]};ready=true;window.render();gate.style.display='none';mark('正在导入此设备的旧数据…');await push();window.render();mark('已连接 · 旧数据已导入','online');return;}
    const next={staff:s.data.map(x=>({id:x.employee_no,name:x.name,dept:x.department})),records:{},leaves:l.data.map(x=>({id:x.id,staff:x.employee_no,type:x.leave_type,from:x.date_from,to:x.date_to,reason:x.reason||'',status:x.status}))};
    for(const x of r.data){next.records[x.work_date]||={};next.records[x.work_date][x.employee_no]={in:x.clock_in||'',out:x.clock_out||'',status:x.status};}
    a.db=next;base=snapshot();localStorage.setItem('attendance-app-v1',JSON.stringify(a.db));ready=true;window.render();gate.style.display='none';mark('已连接 · 自动同步','online');
  }
  async function push(){
    if(!ready)return;
    queue=queue.then(async()=>{try{mark('正在同步…');const oldStaff=new Map(base.staff.map(x=>[x.id,x])),newStaff=new Map(a.db.staff.map(x=>[x.id,x]));
      const ds=[...oldStaff.keys()].filter(id=>!newStaff.has(id));if(ds.length){const q=await supa.from('staff').delete().in('employee_no',ds);if(q.error)throw q.error;}
      const cs=a.db.staff.filter(x=>!oldStaff.has(x.id)||!same(x,oldStaff.get(x.id)));if(cs.length){const q=await supa.from('staff').upsert(cs.map(x=>({employee_no:x.id,name:x.name,department:x.dept})),{onConflict:'employee_no'});if(q.error)throw q.error;}
      const oldR=base.records||{},newR=a.db.records||{};for(const date of Object.keys(oldR)){const gone=Object.keys(oldR[date]||{}).filter(id=>!newR[date]?.[id]);if(gone.length){const q=await supa.from('attendance_records').delete().eq('work_date',date).in('employee_no',gone);if(q.error)throw q.error;}}
      const cr=[];for(const [date,rows] of Object.entries(newR))for(const [id,x] of Object.entries(rows))if(!oldR[date]?.[id]||!same(x,oldR[date][id]))cr.push({work_date:date,employee_no:id,clock_in:x.in||null,clock_out:x.out||null,status:x.status||'未打卡'});
      if(cr.length){const q=await supa.from('attendance_records').upsert(cr,{onConflict:'work_date,employee_no'});if(q.error)throw q.error;}
      for(const x of a.db.leaves)if(!x.id)x.id=crypto.randomUUID();const oldL=new Map(base.leaves.map(x=>[x.id,x])),newL=new Map(a.db.leaves.map(x=>[x.id,x])),dl=[...oldL.keys()].filter(id=>!newL.has(id));
      if(dl.length){const q=await supa.from('leave_requests').delete().in('id',dl);if(q.error)throw q.error;}
      const cl=a.db.leaves.filter(x=>!oldL.has(x.id)||!same(x,oldL.get(x.id)));if(cl.length){const q=await supa.from('leave_requests').upsert(cl.map(x=>({id:x.id,employee_no:x.staff,leave_type:x.type,date_from:x.from,date_to:x.to,reason:x.reason||'',status:x.status})),{onConflict:'id'});if(q.error)throw q.error;}
      base=snapshot();localStorage.setItem('attendance-app-v1',JSON.stringify(a.db));mark('已连接 · 自动同步','online');
    }catch(e){console.error(e);mark('同步失败 · 检查网络/权限','error');window.toast('云端同步失败：'+(e.message||'请检查配置'));}});return queue;
  }
  window.save=function(){localStorage.setItem('attendance-app-v1',JSON.stringify(a.db));return push();};
  async function refresh(){if(!ready)return;try{await load();}catch(e){console.error(e);mark('同步中断','error');}}
  function realtime(){for(const table of ['staff','attendance_records','leave_requests'])supa.channel('shared-'+table).on('postgres_changes',{event:'*',schema:'public',table},()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,450)}).subscribe();}
  function showGate(){gate.style.display='flex';mark('等待登录');}
  document.getElementById('authForm').addEventListener('submit',async e=>{e.preventDefault();if(!supa)return;const f=new FormData(e.target),b=document.getElementById('authSubmit');b.disabled=true;b.textContent='正在登录…';try{const {error}=await supa.auth.signInWithPassword({email:f.get('email'),password:f.get('password')});if(error)throw error;await load();realtime();}catch(x){document.getElementById('authNote').textContent=x.message||'登录失败，请检查账号和配置。';}finally{b.disabled=false;b.textContent='登录';}});
  document.getElementById('signupBtn').addEventListener('click',async()=>{if(!supa)return;const f=new FormData(document.getElementById('authForm'));if(!f.get('email')||!f.get('password')){document.getElementById('authNote').textContent='请先填写邮箱和至少 6 位密码。';return;}try{const {data,error}=await supa.auth.signUp({email:f.get('email'),password:f.get('password')});if(error)throw error;if(data.session){await load();realtime();}else document.getElementById('authNote').textContent='注册请求已提交。若启用了邮箱验证，请先完成邮箱验证，再登录。';}catch(x){document.getElementById('authNote').textContent=x.message||'注册失败。';}});
  (async()=>{const c=window.APP_CONFIG;if(!c?.supabaseUrl||!c?.supabaseAnonKey){showGate();document.getElementById('authNote').textContent='先在 config.js 填入 Supabase 项目地址和 anon/publishable key，再初始化数据库。';mark('尚未配置云端','error');return;}if(!window.supabase){showGate();mark('Supabase 加载失败','error');return;}supa=window.supabase.createClient(c.supabaseUrl,c.supabaseAnonKey);const {data:{session}}=await supa.auth.getSession();if(session){try{await load();realtime();}catch(e){showGate();mark('数据库连接失败','error');document.getElementById('authNote').textContent=e.message||'请检查数据库和团队邮箱名单。';}}else showGate();supa.auth.onAuthStateChange(async(event,s)=>{if(event==='SIGNED_OUT'){ready=false;showGate();}else if(event==='SIGNED_IN'&&!ready){try{await load();realtime();}catch(e){mark('数据库连接失败','error');document.getElementById('authNote').textContent=e.message||'当前邮箱未获团队访问权限。';}}});})();
})();

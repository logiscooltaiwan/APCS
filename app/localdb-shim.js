/* Local stand-in for the Claude platform's claude.use('db'|'user'|'sample') capabilities,
   talking to the small REST API in server/index.js. Mirrors just the subset of the
   Firestore-like shape that app/exam.html actually calls (collection/doc/where/
   onSnapshot/get/set/update/delete), so exam.html itself needs no changes. */
(function(){
  "use strict";

  function genId(){
    if(window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g,'');
    return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2,10);
  }

  async function req(method, path, body){
    const opts = {method, headers:{}, credentials:'same-origin'};
    if(body!==undefined){ opts.headers['Content-Type']='application/json'; opts.body=JSON.stringify(body); }
    let res;
    try{ res = await fetch(path, opts); }
    catch(e){ const err=new Error('unavailable'); err.code='unavailable'; throw err; }
    if(!res.ok){
      let code = res.status===403 ? 'invalid_argument' : res.status===404 ? 'not_found' : 'unavailable';
      try{ const j=await res.json(); if(j && j.code) code=j.code; }catch(e){}
      const err=new Error(code); err.code=code; throw err;
    }
    if(res.status===204) return null;
    try{ return await res.json(); }catch(e){ return null; }
  }

  function docPath(collection, id){
    if(collection==='config') return '/api/config'; // config/exams is a single settings doc
    return `/api/${collection}/${encodeURIComponent(id)}`;
  }

  function makeDocRef(collection, id){
    const path = docPath(collection, id);
    return {
      id,
      async get(){ const d = await req('GET', path); return { exists: d!=null, data:()=>d, id }; },
      set(data){ return req('PUT', path, data); },
      update(data){ return req('PATCH', path, data); },
      delete(){ return req('DELETE', path); },
      onSnapshot(cb, errCb){
        // Real Firestore onSnapshot only fires on the initial load and on actual
        // changes. Polling naively would fire every tick and blow away whatever
        // the user is typing on a view that re-renders from this callback (e.g.
        // the login form), so only call cb() when the fetched data actually changed.
        let stop=false, last;
        (async function tick(){
          if(stop) return;
          try{
            const d = await req('GET', path);
            const key = JSON.stringify(d);
            if(key !== last){ last = key; cb({exists:d!=null, data:()=>d, id}); }
          }
          catch(e){ errCb && errCb(e); }
          if(!stop) setTimeout(tick, 4000);
        })();
        return () => { stop=true; };
      }
    };
  }

  function makeCollectionRef(collection, query){
    const qs = query && Object.keys(query).length ? '?' + new URLSearchParams(query).toString() : '';
    return {
      doc(id){ return makeDocRef(collection, id || genId()); },
      where(field, op, val){ const q=Object.assign({}, query); q[field]=val; return makeCollectionRef(collection, q); },
      async get(){ const list = (await req('GET', `/api/${collection}${qs}`)) || []; return { docs: list.map(d=>({id:d.id, data:()=>d})) }; },
      onSnapshot(cb, errCb){
        // Same change-detection as the doc onSnapshot above, and for the same reason.
        let stop=false, last;
        (async function tick(){
          if(stop) return;
          try{
            const list = (await req('GET', `/api/${collection}${qs}`)) || [];
            const key = JSON.stringify(list);
            if(key !== last){ last = key; cb({ docs: list.map(d=>({id:d.id, data:()=>d})) }); }
          }
          catch(e){ errCb && errCb(e); }
          if(!stop) setTimeout(tick, 4000);
        })();
        return () => { stop=true; };
      }
    };
  }

  const db = {
    collection: (name) => makeCollectionRef(name),
    doc: (path) => { const i=path.indexOf('/'); return makeDocRef(path.slice(0,i), path.slice(i+1)); }
  };

  let meCache = null;
  async function getMe(){
    if(!meCache) meCache = await req('GET','/api/me').catch(()=>({isAdmin:false, aiEnabled:false}));
    return meCache;
  }
  const usr = { canEdit: async () => (await getMe()).isAdmin };

  window.__localAdminLogin = async (password) => { meCache=null; return req('POST','/api/admin/login',{password}); };
  window.__localAdminLogout = async () => { meCache=null; return req('POST','/api/admin/logout'); };

  window.claude = {
    use: async (name) => {
      if(name==='db') return db;
      if(name==='user') return usr;
      if(name==='sample'){
        const me = await getMe();
        if(!me.aiEnabled) return null;
        return { json: async (prompt) => { const r = await req('POST','/api/ai/grade',{prompt}); return r.result; } };
      }
      return null;
    }
  };
})();

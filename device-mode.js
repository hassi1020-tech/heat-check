
(() => {
  const MODE_KEY = "heatCheckDeviceMode";
  const DEVICE_ID_KEY = "heatCheckDeviceId";
  const params = new URLSearchParams(location.search);

  function generateDeviceId(){
    const existing=localStorage.getItem(DEVICE_ID_KEY);
    if(existing) return existing;
    const id="DEV-"+crypto.getRandomValues(new Uint32Array(2))
      .reduce((s,n)=>s+n.toString(36).toUpperCase(),"").slice(0,10);
    localStorage.setItem(DEVICE_ID_KEY,id);
    return id;
  }
  function requestedMode(){
    const q=params.get("mode");
    if(q==="kiosk" || q==="admin") return q;
    return localStorage.getItem(MODE_KEY) || "admin";
  }
  function updateUrl(mode){
    const url=new URL(location.href);
    url.searchParams.set("mode",mode);
    url.searchParams.set("v","1200s3");
    history.replaceState(null,"",url);
  }
  function setActiveButtons(mode){
    document.getElementById("modeKioskButton")?.classList.toggle("active",mode==="kiosk");
    document.getElementById("modeAdminButton")?.classList.toggle("active",mode==="admin");
  }
  function applyMode(mode, navigate=true){
    localStorage.setItem(MODE_KEY,mode);
    document.documentElement.dataset.deviceMode=mode;
    document.body?.classList.toggle("kiosk-mode",mode==="kiosk");
    document.body?.classList.toggle("admin-mode",mode==="admin");
    setActiveButtons(mode);

    const welcome=document.getElementById("kioskWelcome");
    welcome?.classList.toggle("hidden",mode!=="kiosk");
    const deviceEl=document.getElementById("kioskDeviceId");
    if(deviceEl) deviceEl.textContent=generateDeviceId();

    document.querySelectorAll('[data-role="admin-only"]').forEach(el=>{
      el.classList.toggle("mode-hidden",mode==="kiosk");
    });

    if(navigate && window.HeatCheckApp?.switchView){
      window.HeatCheckApp.switchView(mode==="kiosk" ? "measure" : "dashboard");
    }
    updateUrl(mode);
  }

  function stampDeviceId(){
    const app=window.HeatCheckApp;
    if(!app?.loadDB || !app?.saveDB) return;
    const db=app.loadDB();
    const deviceId=generateDeviceId();
    let changed=false;
    db.records=(db.records||[]).map(record=>{
      if(record.deviceId) return record;
      changed=true;
      return {...record,deviceId,deviceMode:"kiosk"};
    });
    if(changed) app.saveDB(db);
  }

  document.addEventListener("DOMContentLoaded",()=>{
    document.getElementById("modeKioskButton")?.addEventListener("click",()=>applyMode("kiosk"));
    document.getElementById("modeAdminButton")?.addEventListener("click",()=>applyMode("admin"));
    applyMode(requestedMode());
    window.addEventListener("heatcheck:localdbchanged",()=>{
      if(document.documentElement.dataset.deviceMode==="kiosk") stampDeviceId();
    });
  });
})();

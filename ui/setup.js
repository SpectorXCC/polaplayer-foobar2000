/* verdant/ui/setup.js -- first-run and reusable source/appearance setup. */

var SETUP_PROP='Setup: music sources (local / both)';
var SETUP_THEME_PROP='Display: colour mode (0 = auto, 1 = dark, 2 = light)';
var SETUP_NAV_URL='https://www.foobar2000.org/components/view/foo_navidrome';
var setupMode='both', setupNeedsWelcome=false, setupDraftMode='local', setupPrompt=null, SETUP_HB=[];
var setupNavNeedsRefresh=false;

function initSetup(previousSource){
  var stored=propStr(SETUP_PROP,'');
  if(stored==='local'||stored==='both'){ setupMode=stored; return; }
  // Earlier Verdant versions always persisted the selected source. Preserve their UI.
  setupNeedsWelcome=stored==='pending'||stored==='pending-both'||(previousSource!=='local'&&previousSource!=='navidrome');
  setupMode=setupNeedsWelcome?'local':'both';
  setupDraftMode=stored==='pending-both'?'both':'local';
  try{ window.SetProperty(SETUP_PROP,setupNeedsWelcome?(setupDraftMode==='both'?'pending-both':'pending'):setupMode); }catch(e){}
}

function openSetup(firstRun){
  if(setupPrompt) return;
  clearNormalOverlays();
  setupPrompt={firstRun:!!firstRun,step:1,mode:firstRun?setupDraftMode:setupMode,theme:THEME_MODE,originalTheme:THEME_MODE,navStatus:'idle',probe:0};
  SETUP_HB=[];
  layout(); repaintAll();
}

function setupPreferences(){
  try{ fb.ShowPreferences(); }catch(e){}
}

function setupNavInstalled(){
  var found=null;
  try{
    if(typeof utils.CheckComponent==='function') found=!!(utils.CheckComponent('foo_navidrome',true)||utils.CheckComponent('Navidrome / Subsonic Browser',false)||utils.CheckComponent('Navidrome',false));
  }catch(e){}
  // JSplitter versions differ in filename/name matching; the component's own menu is another signal.
  if(found!==true) try{
    var cmds=JSON.parse(fb.EnumerateMainMenuCommands());
    for(var i=0;i<cmds.length;i++) if(/navidrome/i.test(cmds[i].FullPath||'')) return true;
  }catch(e){}
  return found;
}

function setupProbe(){
  var s=setupPrompt;
  if(!s||s.mode!=='both') return;
  var probe=++s.probe, installed=setupNavInstalled();
  if(installed===false){s.navStatus='missing';repaintAll();return;}
  var c=nvConnection(true,true); // saved plugin configuration, never an unrelated now-playing stream
  if(!c){s.navStatus='unconfigured';repaintAll();return;}
  s.navStatus='testing'; repaintAll();
  nvApiRequest(c,'ping',{}, {timeoutMs:10000,maxBytes:65536,checkCancel:function(){return setupPrompt!==s||s.probe!==probe;}}, function(body){
    if(setupPrompt!==s||s.probe!==probe) return;
    // Report only a generic status: credentials, server URLs and raw errors never reach the wizard.
    s.navStatus=body?'connected':'failed'; repaintAll();
  });
}

function setupClose(commit){
  var s=setupPrompt;
  if(!s) return;
  setupPrompt=null; SETUP_HB=[]; hoverKey='';
  if(commit||s.firstRun){
    setupMode=commit?s.mode:'local';
    setupNeedsWelcome=false;
    THEME_MODE=commit?s.theme:s.originalTheme;
    try{ window.SetProperty(SETUP_PROP,setupMode);window.SetProperty(SETUP_THEME_PROP,THEME_MODE); }catch(e){}
    if(setupMode==='local'&&libSource!=='local') switchLibrarySource('local');
    // A server may have been configured after a previous failed browse. Refresh only when used.
    if(commit&&setupMode==='both'&&s.navStatus==='connected'&&NVData.initDone){
      if(libSource==='navidrome') nvRefreshAll(false);
      else setupNavNeedsRefresh=true;
    }
  } else THEME_MODE=s.originalTheme;
  syncTheme(); layout(); repaintAll(true);
}

function setupAction(act){
  var s=setupPrompt;
  if(!s) return;
  if(act==='skip'){setupClose(false);return;}
  if(act==='finish'&&s.step===3){setupClose(true);return;}
  if(act==='next'&&s.step<3){
    s.step++;
    if(s.step===2&&s.mode==='both') setupProbe();
  } else if(act==='back'&&s.step>1){
    s.step--;
  } else if(s.step===1&&(act==='source-local'||act==='source-both')){
    var mode=act==='source-both'?'both':'local';
    if(s.mode!==mode){
      s.mode=mode;s.navStatus='idle';s.probe++;
      if(s.firstRun){setupDraftMode=mode;try{window.SetProperty(SETUP_PROP,mode==='both'?'pending-both':'pending');}catch(e){}}
    }
  } else if(s.step===2){
    if(act==='local-prefs'||act==='nav-prefs') setupPreferences();
    else if(act==='nav-test') setupProbe();
    else if(act==='nav-install'){
      try{ new ActiveXObject('Shell.Application').ShellExecute(SETUP_NAV_URL); }catch(e){ try{ fb.ShowPopupMessage(SETUP_NAV_URL,T('setup.install')); }catch(e2){} }
    }
  } else if(s.step===3&&/^theme-[012]$/.test(act)){
    s.theme=Number(act.slice(-1)); THEME_MODE=s.theme; syncTheme();
  }
  SETUP_HB=[]; repaintAll();
}

function setupClick(x,y){
  var b=hit(SETUP_HB,x,y);
  if(b) setupAction(b.act);
}

function setupButton(gr,x,y,w,h,label,act,primary,selected){
  var hot=hv(x,y,x+w,y+h), rad=Math.min(10,h/2);
  gr.FillRoundRect(x,y,w,h,rad,rad,primary?(hot?COL.greenHot:COL.green):(hot?COL.btnHot:COL.field));
  if(selected) strokeRound(gr,x,y,w,h,rad,1.5,COL.green);
  tC(gr,label,FONT.pl,primary?COL.black:(selected?COL.green:COL.text),x+4,y,w-8,h);
  SETUP_HB.push({x0:x,y0:y,x1:x+w,y1:y+h,act:act});
}

function setupParagraph(gr,text,x,y,w,lines,color){
  var wrapped=gr.EstimateLineWrap(text,FONT.plSub,w);
  for(var i=0;i<Math.min(wrapped.length,lines*2);i+=2) tL(gr,wrapped[i],FONT.plSub,color||COL.text2,x,y+i*8,w,16);
}

function setupSourceCard(gr,x,y,w,h,title,desc,mode){
  var selected=setupPrompt.mode===mode, hot=hv(x,y,x+w,y+h);
  gr.FillRoundRect(x,y,w,h,10,10,hot?COL.btnHot:COL.field);
  if(selected) strokeRound(gr,x,y,w,h,10,1.5,COL.green);
  tL(gr,title,FONT.pl,selected?COL.green:COL.text,x+12,y+6,w-42,22);
  if(selected) gr.FillEllipse(x+w-24,y+14,8,8,COL.green);
  setupParagraph(gr,desc,x+12,y+29,w-24,2);
  SETUP_HB.push({x0:x,y0:y,x1:x+w,y1:y+h,act:'source-'+mode});
}

function drawSetup(gr){
  var s=setupPrompt; if(!s) return;
  SETUP_HB=[];
  var cw=Math.min(568,W-20), ch=Math.min(s.step===2?400:354,H-TBH-12);
  if(cw<240||ch<210) return; // minimum window metrics normally prevent this
  var cy=Math.round(TBH+(H-TBH-ch)/2), cx=Math.round((W-cw)/2);
  var compact=ch<325, p=compact?12:24, x=cx+p, w=cw-p*2;
  gr.FillSolidRect(0,TBH,W,H-TBH,RGBA(0,0,0,IS_LIGHT?70:160));
  gr.FillRoundRect(cx+2,cy+4,cw,ch,12,12,COL.shadow);
  gr.FillRoundRect(cx,cy,cw,ch,12,12,COL.modal);
  tL(gr,T('setup.progress',s.step),FONT.eyebrow,COL.green,x,cy+p,w,18);
  var title=s.step===1?'setup.welcome':s.step===2?'setup.libraries':'setup.appearance';
  tL(gr,T(title),FONT.sect2,COL.text,x,cy+p+19,w,30);
  var top=cy+p+56, footer=cy+ch-p-34, body=Math.max(0,footer-top-8);
  if(s.step===1){
    if(!compact){ setupParagraph(gr,T('setup.choose_source'),x,top,w,2);top+=30;body-=30; }
    var cardH=Math.min(76,Math.floor((body-8)/2));
    setupSourceCard(gr,x,top,w,cardH,T('source.local'),T('setup.local_desc'),'local');
    setupSourceCard(gr,x,top+cardH+8,w,cardH,T('setup.both'),T('setup.both_desc'),'both');
  } else if(s.step===2){
    var bw=Math.min(138,Math.floor(w*0.46));
    tL(gr,T('source.local'),FONT.pl,COL.text,x,top,w-bw-8,24);
    setupButton(gr,x+w-bw,top,bw,27,T('setup.preferences'),'local-prefs',false,false);
    setupParagraph(gr,T('setup.local_path'),x,top+30,w,2);
    if(s.mode==='both'){
      var ny=top+(compact?58:76);
      gr.DrawLine(x,ny-5,x+w,ny-5,1,COL.line);
      tL(gr,T('source.navidrome'),FONT.pl,COL.text,x,ny,w,20);
      var statusKey='setup.nav_'+s.navStatus;
      setupParagraph(gr,T(statusKey),x,ny+22,w,2,s.navStatus==='connected'?COL.green:(s.navStatus==='failed'?COL.danger:COL.text2));
      var by=Math.max(ny+55,footer-36), half=Math.floor((w-8)/2);
      if(s.navStatus==='missing') setupButton(gr,x,by,half,29,T('setup.install'),'nav-install',false,false);
      else setupButton(gr,x,by,half,29,T('setup.preferences'),'nav-prefs',false,false);
      setupButton(gr,x+half+8,by,w-half-8,29,T('setup.test'),'nav-test',false,false);
    } else {
      setupParagraph(gr,T('setup.local_later'),x,top+(compact?74:94),w,3);
    }
  } else {
    var h=Math.min(43,Math.floor((body-12)/3));
    setupButton(gr,x,top,w,h,T('setup.system'),'theme-0',false,s.theme===0);
    setupButton(gr,x,top+h+6,w,h,T('setup.dark'),'theme-1',false,s.theme===1);
    setupButton(gr,x,top+(h+6)*2,w,h,T('setup.light'),'theme-2',false,s.theme===2);
  }
  var btnW=Math.min(124,Math.floor((w-16)/3)), gap=8;
  setupButton(gr,x,footer,btnW,34,T(s.firstRun?'setup.skip':'btn.cancel'),'skip',false,false);
  if(s.step>1) setupButton(gr,x+w-btnW*2-gap,footer,btnW,34,T('setup.back'),'back',false,false);
  setupButton(gr,x+w-btnW,footer,btnW,34,T(s.step===3?'setup.start':'setup.next'),s.step===3?'finish':'next',true,false);
}

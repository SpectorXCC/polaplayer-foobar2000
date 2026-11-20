/* verdant/core/props.js -- panel properties, resolved before anything sizes itself
   Part of Verdant, a Spotify-style theme for foobar2000. Loaded by main.js;
   every module shares one global scope, so load order is set there. */

/* Panel settings live in JSplitter's own per-panel property store (right-click > Properties),
   which means they travel with the layout: the shipped configuration carries these defaults, so
   a fresh install is already correct without anyone opening the dialog.

   Read once, here, because the values are consumed at LOAD time -- core/tokens.js builds every
   font from UISCALE and ui/chrome.js sizes the title bar from it. The display watcher applies
   scale changes live; other properties are read when the panel reloads. */
function propNum(name,dflt){
  var v=dflt;
  try{ v=window.GetProperty(name,dflt); }catch(e){ v=dflt; }
  v=parseFloat(v);
  return isFinite(v)?v:dflt;
}
function propStr(name,dflt){
  var v=dflt;
  try{ v=window.GetProperty(name,dflt); }catch(e){ v=dflt; }
  return (v===undefined||v===null)?dflt:String(v).trim();
}
var UI_FONT_PROP='Display: UI font (auto / cui / font name)';
var LYRIC_FONT_PROP='Lyrics: font (auto = match UI / cui / font name)';

/* Which visualizer the fullscreen view draws. Deliberately NOT a panel property: the picker in
   fullscreen is the place to change it, and mirroring the choice into window.SetProperty only
   put a second, duplicate control in the Properties dialog. The cost is that the choice lasts
   for the session rather than across a restart. An unknown value falls through to the bars
   (see drawVizBody). */
var vizStyle = 'bars';

/* 0 = auto: follow the display, where 96 dpi is 100% scaling. Auto is right on most machines;
   set a number to override -- 1.0 is compact, 1.25 suits a 1440p 21", higher for a 4K panel.
   Clamped because a bad value here makes the panel unusable rather than merely ugly. */
// JSplitter's integer property editor truncates fractional values. Preserve the existing
// setting as text so values such as 1.25 and 2.5 survive editing and profile saves.
try{
  var _scaleName='Display: UI scale (0 = auto)';
  var _savedScale=window.GetProperty(_scaleName,'0');
  if(typeof _savedScale!=='string')window.SetProperty(_scaleName,String(_savedScale));
}catch(e){}
var UISCALE = propNum('Display: UI scale (0 = auto)', 0);
if(UISCALE<=0){
  var _dpi=96;
  try{ _dpi=window.DPI||96; }catch(e){ _dpi=96; }
  UISCALE=_dpi/96;
}
UISCALE=Math.max(0.75,Math.min(3,UISCALE));

/* Output ceiling, in dB below foobar's own maximum, applied to the volume slider's full position.
   0 is foobar's range unchanged and is the right default: a theme has no business making anyone's
   music quieter without being asked. Set it negative on a system with plenty of gain downstream,
   where the top of the scale is unusable and the slider's whole travel is better spent lower --
   -12 is a quarter of the amplitude, -20 nearer a quarter of the perceived loudness. Clamped, since
   a wild value here would leave no usable range at all. */
var VOL_CEIL = Math.max(-60, Math.min(0, propNum('Playback: output ceiling (dB below max)', 0)));

/* Wheel step for the continuous (pixel-scrolled) lists. The tall artist cards scale this up
   themselves; see on_mouse_wheel. */
var WHEEL_PX = Math.max(20, propNum('Scrolling: wheel step (px)', 180));

/* Show the playing track on your Discord profile, via the bundled foo_verdant component.
   On by default, because a feature nobody can find is worse than one that announces itself --
   and because the card is a large part of why this theme exists.

   Set to 0 and reload the panel to turn it off. That genuinely turns it OFF: the panel tells
   the component to stand down, so no track data is published and no connection to the Discord
   client is opened at all. Does nothing if foo_verdant is not installed.
   See data/discord.js. */
var DRP_ON = propNum('Discord: show the playing track (1 = on)', 1) > 0;

/* Colour mode. 0 = auto: follow Columns UI's dark/light mode (set Columns UI > Colours and fonts
   > Mode to "Follow system" and the theme tracks Windows, switching live). 1 = always dark,
   2 = always light. Fullscreen stays dark in every mode -- it is drawn over the album art.
   Read at load, like the others: reload the panel after changing it. See core/tokens.js. */
var THEME_MODE = Math.round(propNum('Display: colour mode (0 = auto, 1 = dark, 2 = light)', 0));
if(THEME_MODE!==1 && THEME_MODE!==2) THEME_MODE=0;

/* Animation target rate. 0 = auto targets 120fps (8ms interval; Windows SetTimer typically caps
   around ~100Hz while keeping physical speed consistent via elapsed dt). Set 60..240 as desired. */
var ANIM_FPS_RAW = propNum('Animation: target FPS (0 = auto)', 0);
var ANIM_FPS = ANIM_FPS_RAW > 0 ? Math.max(30, Math.min(240, ANIM_FPS_RAW)) : 120;
var ANIM_MS = Math.max(8, Math.floor(1000 / ANIM_FPS));
function nowMs(){
  try{ if(typeof performance==='object' && performance && typeof performance.now==='function') return performance.now(); }catch(e){}
  return Date.now();
}

# Third-party notices

PolaPlayer for foobar2000 is based on [Verdant](https://github.com/superziper/verdant-foobar2000-theme) by superziper. The original MIT copyright notice and license are preserved in [LICENSE](LICENSE).

The following external applications and components are installed separately. Their own licenses and terms apply; their binaries are not bundled in this source repository.

| Dependency | Project |
| --- | --- |
| foobar2000 | https://www.foobar2000.org/ |
| Columns UI | https://github.com/reupen/columns_ui |
| JSplitter | https://hydrogenaudio.org/index.php/topic,126743.0.html |
| UI Wizard (optional) | https://github.com/The-Wizardium/UI-Wizard |
| Navidrome Browser (optional) | https://github.com/santiagorod92/foo_navidrome |
| Verdant Discord Presence (optional) | Optional external `foo_verdant` component; not distributed here. |

The optional `Verdant.Chrome` helper is implemented in this repository under `native/`. Its source is included. The MinGW-w64 build links GCC runtime libraries; see the [GCC Runtime Library Exception](https://www.gnu.org/licenses/gcc-exception-3.1.html). When built with WebView2 support (`native/fetch-webview2.ps1`), `native/WebView2Loader.dll` is redistribution of the Microsoft Edge WebView2 SDK under Microsoft's WebView2 SDK license (`native/vendor/webview2/LICENSE.txt`). Legacy names in the filesystem, COM registration and code are intentional compatibility identifiers.

The optional `fullscreen-web/` bundle integrates [`@applemusic-like-lyrics/core`](https://github.com/Steve-xmh/applemusic-like-lyrics) (`AGPL-3.0-only`). If you distribute a pre-built bundle containing `fullscreen-web/dist/`, AGPL-3.0 obligations apply to that bundle.

PolaPlayer operates independently of the respective third-party projects. Product names belong to their owners.

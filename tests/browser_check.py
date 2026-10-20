# /// script
# requires-python = ">=3.10"
# dependencies = ["playwright==1.55.0", "pillow==11.3.0", "pypdf==6.1.1"]
# ///
"""Real Chromium workflows. Run `uv run tests/browser_check.py` from the repo root."""
import io,json,pathlib,subprocess,tempfile,time,threading,http.server,functools,os,shutil
from playwright.sync_api import sync_playwright,expect
from PIL import Image
from pypdf import PdfReader,PdfWriter
ROOT=pathlib.Path(__file__).resolve().parents[1];F=ROOT/'tests/fixtures';E=ROOT/'.test-output';E.mkdir(exist_ok=True)
subprocess.run(['node','--test','tests/core.test.mjs'],cwd=ROOT,check=True,stdout=(E/'core-tests.txt').open('w'))
for name,color,size in [('portrait.png','#dce9bc',(320,480)),('landscape.jpg','#315d47',(640,360))]:Image.new('RGB',size,color).save(F/name)
writer=PdfWriter();writer.append(str(F/'alpha.pdf'));writer.encrypt('synthetic-test-password');writer.write(str(F/'encrypted.pdf'))
(F/'broken.pdf').write_text('not a pdf');(F/'empty.pdf').write_bytes(b'');(F/'wrong.txt').write_text('not a PDF')
handler=functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT));server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler);threading.Thread(target=server.serve_forever,daemon=True).start();url=f'http://127.0.0.1:{server.server_port}'
checks=[]
def ok(name):checks.append(name)
def texts(path):return [p.extract_text().strip() for p in PdfReader(str(path)).pages]
def download(page,name):
 with page.expect_download() as pending:page.locator('#download').click()
 target=E/name;pending.value.save_as(target);return target
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser'),headless=True);ctx=browser.new_context(viewport={'width':1440,'height':1050},accept_downloads=True);page=ctx.new_page();errors=[];requests=[];ctx.on('request',lambda r:requests.append((r.method,r.url)));page.on('pageerror',lambda e:errors.append(str(e)));page.on('dialog',lambda d:d.accept())
  ctx.route('**/*',lambda route:route.continue_() if route.request.url.startswith(url) else route.abort())
  page.goto(url);expect(page.locator('#tool-title')).to_contain_text('together');page.screenshot(path=str(ROOT/'docs/screenshots/desktop-home.png'),full_page=True);ok('Home loads with local assets only')
  page.locator('#files').set_input_files([str(F/'alpha.pdf'),str(F/'beta.pdf')]);expect(page.locator('.page-card')).to_have_count(5);page.locator('.page-preview').first.scroll_into_view_if_needed();expect(page.locator('.page-preview img').first).to_be_visible();expect(page.locator('#notice')).to_contain_text('Added 2 files');ok('Merge reads two actual PDFs and renders real page thumbnails')
  out=download(page,'merged.pdf');assert texts(out)==['ALPHA ONE','ALPHA TWO','ALPHA THREE','BETA ONE','BETA TWO'];ok('Merge download preserves independently extracted text in all five pages')
  page.locator('.page-card').first.locator('[data-action=down]').click();page.locator('.page-card').first.locator('[data-action=rotate]').click();page.locator('.page-card input').nth(2).uncheck();out=download(page,'organized.pdf');assert texts(out)==['ALPHA TWO','ALPHA ONE','BETA ONE','BETA TWO'];assert PdfReader(str(out)).pages[0].rotation==180;ok('Page reorder, deselection and rotation survive downloaded output')
  page.screenshot(path=str(ROOT/'docs/screenshots/desktop-workspace.png'),full_page=True)
  page.locator('[data-mode=extract]').click();page.locator('#files').set_input_files(str(F/'alpha.pdf'));expect(page.locator('.page-card')).to_have_count(3);page.locator('#range').fill('3,1');page.locator('#apply-range').click();expect(page.locator('#selection-count')).to_have_text('2 of 3 pages selected');out=download(page,'extracted.pdf');assert texts(out)==['ALPHA THREE','ALPHA ONE'];r=PdfReader(str(out));assert float(r.pages[0].mediabox.width)==440;ok('Extract respects explicit range order, text and original dimensions')
  page.locator('#range').fill('0,999');page.locator('#apply-range').click();expect(page.locator('#notice')).to_have_class('notice error');expect(page.locator('#selection-count')).to_have_text('2 of 3 pages selected');ok('Invalid range keeps prior selection intact')
  page.locator('#select-none').click();expect(page.locator('#download')).to_be_disabled();page.locator('#select-all').click();ok('No-selection export is disabled and can be restored')
  ctx.set_offline(True);out=download(page,'offline.pdf');assert len(PdfReader(str(out)).pages)==3;ctx.set_offline(False);ok('PDF export works with browser network switched offline after load')
  page.locator('#files').set_input_files(str(F/'beta.pdf'));expect(page.locator('#notice')).to_contain_text('one PDF');expect(page.locator('.page-card')).to_have_count(3);ok('Single-PDF tools reject extra source without dropping current pages')
  page.locator('#reset').click();expect(page.locator('#editor')).to_be_hidden();ok('Clear removes file workspace')
  for name,fragment in [('encrypted.pdf','Password-protected'),('broken.pdf','could not be read'),('empty.pdf','empty'),('wrong.txt','PDF files only')]:
   page.locator('#files').set_input_files(str(F/name));expect(page.locator('#notice')).to_contain_text(fragment);expect(page.locator('#editor')).to_be_hidden();ok(f'{name} rejected with clear error')
  page.locator('[data-mode=merge]').click();page.locator('#files').set_input_files([str(F/'alpha.pdf'),str(F/'broken.pdf')]);expect(page.locator('#notice')).to_contain_text('could not be read');expect(page.locator('.page-card')).to_have_count(0);ok('Invalid mixed batch is atomic, not partially added')
  page.locator('[data-mode=images]').click();page.locator('#files').set_input_files([str(F/'portrait.png'),str(F/'landscape.jpg')]);expect(page.locator('.page-card')).to_have_count(2);page.locator('.page-preview').first.scroll_into_view_if_needed();expect(page.locator('.page-preview img').first).to_be_visible();out=download(page,'photos-a4.pdf');r=PdfReader(str(out));assert len(r.pages)==2;assert abs(float(r.pages[0].mediabox.width)-595.28)<.1;assert abs(float(r.pages[1].mediabox.width)-841.89)<.1;assert all(len(p.images)==1 for p in r.pages);ok('PNG and JPEG become real embedded-image PDFs with orientation-aware A4 dimensions')
  page.locator('#page-size').select_option('original');out=download(page,'photos-original.pdf');r=PdfReader(str(out));assert float(r.pages[0].mediabox.width)==240;assert float(r.pages[0].mediabox.height)==360;assert float(r.pages[1].mediabox.width)==480;ok('Original photo size uses documented 96px/inch conversion')
  page.locator('.page-card').first.locator('[data-action=down]').click();page.locator('.page-card').first.locator('[data-action=rotate]').click();out=download(page,'photos-reordered.pdf');r=PdfReader(str(out));assert float(r.pages[0].mediabox.width)==480 and r.pages[0].rotation==90;ok('Photo reorder and rotation persist')
  page.locator('#filename').fill('../../report');
  with page.expect_download() as d:page.locator('#download').click()
  assert '/' not in d.value.suggested_filename and d.value.suggested_filename.endswith('.pdf');ok('Download filenames strip path separators')
  page.locator('#filename').fill('paperlocal-photos.pdf');page.set_viewport_size({'width':390,'height':844});page.locator('#download').scroll_into_view_if_needed();expect(page.locator('#download')).to_be_visible();page.wait_for_timeout(200);page.screenshot(path=str(ROOT/'docs/screenshots/mobile-workspace.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');ok('390px mobile workspace has no horizontal overflow')
  page.locator('[data-mode=organize]').click();page.locator('#files').set_input_files(str(F/'beta.pdf'));expect(page.locator('.page-card')).to_have_count(2);page.locator('.page-card').first.locator('[data-action=down]').click();out=download(page,'organize-tool.pdf');assert texts(out)==['BETA TWO','BETA ONE'];ok('Standalone Organize tool reorders actual PDF output')
  page.locator('[data-mode=merge]').click();page.locator('#files').set_input_files({'name':'<img onerror=alert(1)>.pdf','mimeType':'application/pdf','buffer':(F/'alpha.pdf').read_bytes()});expect(page.locator('.page-card')).to_have_count(3);assert page.locator('.page-card small img').count()==0;ok('Untrusted filenames remain text, not executable HTML')
  page.keyboard.press('Tab');assert page.evaluate('document.activeElement.tagName')!='BODY';ok('Workspace controls participate in keyboard navigation')
  assert all(method=='GET' and target.startswith(url) for method,target in requests);assert not errors,errors;ok('Zero document-upload requests, third-party requests or uncaught JavaScript errors across workflows')
  result={'checks':checks,'count':len(checks),'browser':browser.version,'viewport_tests':['1440x1050','390x844'],'requests':requests,'page_errors':errors,'limits':'Linux Chromium only; no physical phone/Safari/Firefox testing'};(E/'browser-results.json').write_text(json.dumps(result,indent=2));print(json.dumps({'passed':len(checks),'checks':checks},indent=2));ctx.close();browser.close()
finally:server.shutdown()

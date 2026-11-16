"""Installed WebKit UI checks with an offline synthetic image provider.

The driver operates the shipped UI and reads its persisted records. It never
inserts project/task records or replaces application/native bridge functions.
"""
import time

MODEL45 = 'doubao-seedream-4-5-251128'
MODEL55 = 'doubao-seedream-5-5-261028'
PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAc0lEQVR4nO3QQQ0AIAwAsb0RgbrpRAkicAAilj1IeskZaJyZt/OxdutRDQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPgf4AFC+3nDnYDTzQAAAABJRU5ErkJggg=='


def model_response(body):
    assert body['model'] in [MODEL45, MODEL55]
    if body.get('layer_decomposition_options'):
        assert body['model'] == MODEL55
        assert body['layer_decomposition_options']['text_recognition'] is True
        return {'data': [dict(url='data:image/png;base64,' + PNG, z_index=i,
                             name='标题' + str(i) if i else '底图', description='SYNTHETIC', size='64x64',
                             bounding_box={'absolute': [0, 0, 64, 64], 'normalized': [0, 0, 1000, 1000]},
                             background='transparent' if i else 'opaque',
                             **({'text_recognition': {'text': '你好 ' + str(i), 'lines': []}} if i else {}))
                         for i in range(3)]}
    if body['model'] == MODEL55:
        assert body['background'] == 'transparent' and body['output_format'] == 'png'
    return {'data': [{'url': 'data:image/png;base64,' + PNG}]}


class CreativeChecks:
    def __init__(self, execute, screenshot, element_action):
        self.execute, self.screenshot, self.element_action = execute, screenshot, element_action

    def wait(self, fn, description):
        end = time.monotonic() + 75
        while time.monotonic() < end:
            result = fn()
            if result:
                return result
            time.sleep(0.25)
        raise AssertionError(description)

    def action(self, selector, text=None, value=None):
        def attempt():
            return self.execute('''const [selector,text,value]=arguments;
const visible=e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden';
const matches=[...document.querySelectorAll(selector)].filter(e=>visible(e) && !e.disabled &&
 (text===null || e.textContent.trim()===text || e.getAttribute('aria-label')===text));
return matches.find(e=>!matches.some(child=>child!==e && e.contains(child))) || null;''', args=[selector, text, value])
        element = self.wait(attempt, 'Missing actionable UI: ' + selector + ' / ' + str(text))
        self.element_action(element, value)

    def records(self, db, store):
        result = self.execute('''const [db,store]=arguments,done=arguments[arguments.length-1];
(async()=>{if(!(await indexedDB.databases()).some(d=>d.name===db))return [];
return await new Promise((resolve,reject)=>{const r=indexedDB.open(db);r.onerror=()=>reject(r.error);
r.onsuccess=()=>{const c=r.result;if(!c.objectStoreNames.contains(store)){c.close();resolve([]);return;}
const q=c.transaction(store).objectStore(store).getAll();q.onsuccess=()=>{c.close();resolve(q.result)};
q.onerror=()=>{c.close();reject(q.error)}}})})().then(done,e=>done({error:String(e)}));''', True, [db, store])
        assert isinstance(result, list), result
        return result

    def enter(self):
        if not self.execute('return Boolean(document.querySelector("nav[aria-label=创作导航]"))'):
            self.action('button', 'opentu 创作')

    def canvas(self):
        self.enter()
        self.action('nav[aria-label=创作导航] button', '自由画布')
        self.wait(lambda: self.execute('return Boolean(document.querySelector(".plait-board-container"))'), 'Canvas missing')
        self.execute('''const e=[...document.querySelectorAll('button,label,span')].find(e=>e.textContent.trim()==='不再提示' && e.getClientRects().length);if(e)e.click();return true;''')

    def leave(self):
        self.action('button', '兔子助手导航')
        self.action('button', 'Codex')

    def configure(self):
        if not self.execute('return Boolean(document.querySelector("[data-testid=settings-dialog]"))'):
            self.action('button', '创作配置')
        self.action('[data-testid=settings-dialog] button', '手动配置')
        self.action('[data-testid=settings-dialog] input[type=password]', value='sk-SYNTHETIC-GENERATION')
        field = self.execute('''const d=document.querySelector('[data-testid=settings-dialog]');
const f=[...d.querySelectorAll('.settings-dialog__field')].find(e=>e.querySelector('label')?.textContent.trim()==='API 地址');
return f?.querySelector('input') || null;''')
        assert field
        self.element_action(field, 'https://api.tu-zi.com/v1')
        self.action('[data-testid=settings-dialog] button', '保存')
        self.wait(lambda: not self.execute('return Boolean(document.querySelector("[data-testid=settings-dialog]"))'), 'Settings did not close')

    def snapshot(self):
        self.wait(lambda: (boards := self.records('aitu-workspace', 'boards')) and
                  all(e['type'] != 'generation-anchor' for b in boards for e in b['elements']), 'Insertion never settled')
        boards = [b for b in self.records('aitu-workspace', 'boards') if any(e['type'] == 'image' for e in b['elements'])]
        assert boards, 'UI did not persist an image board'
        return {'boards': [{k: b[k] for k in ['id', 'name', 'elements']} for b in boards],
                'taskIds': [t['id'] for t in self.records('aitu-app', 'tasks') if t.get('insertedToCanvas')]}

    def pixels(self, element_id):
        self.wait(lambda: self.execute('''const i=document.querySelector(`[plait-data-id="${arguments[0]}"] img`);return i?.complete && i.naturalWidth===64;''', args=[element_id]), 'Image pixels unavailable')
        pixels = self.execute('''const i=document.querySelector(`[plait-data-id="${arguments[0]}"] img`),c=document.createElement('canvas');
c.width=c.height=64;const x=c.getContext('2d');x.drawImage(i,0,0);return [8,32,56].map(p=>[...x.getImageData(p,8,1,1).data]);''', args=[element_id])
        assert pixels == [[240, 30, 100, 255], [10, 190, 220, 255], [0, 0, 0, 0]], pixels

    def create(self, current=False):
        self.enter(); self.configure(); self.canvas()
        before = self.records('aitu-app', 'tasks')
        self.action('.model-dropdown__trigger')
        self.action('button,div,span', '豆包')
        desired = '5.5' if current else '4.5'
        option = self.wait(lambda: self.execute('''return [...document.querySelectorAll('.model-dropdown__item')].find(e=>e.getClientRects().length && e.textContent.includes(arguments[0])) || null;''', args=[desired]), 'Model option missing')
        self.element_action(option, None)
        if current:
            self.action('.parameters-dropdown__trigger')
            self.action('button,div,span', '透明（PNG）')
        self.action('.ai-input-bar__input', value='SYNTHETIC installed upgrade ' + desired)
        self.action('[data-track=ai_input_click_send]')
        task = self.wait(lambda: next((t for t in self.records('aitu-app', 'tasks') if t['id'] not in [b['id'] for b in before] and t.get('insertedToCanvas')), None), 'Generation did not reach persisted canvas')
        saved = self.snapshot()
        element = next(e for b in saved['boards'] for e in b['elements'] if e.get('generationTaskId') == task['id'])
        self.pixels(element['id'])
        if current:
            self.action('button', 'Seedream 5.5 分层 / OCR')
            checked = self.execute('return document.querySelector(".layer-decomposition-dialog input[type=checkbox]")?.checked')
            if not checked:
                self.action('.layer-decomposition-dialog input[type=checkbox]')
            self.action('.layer-decomposition-dialog button', '开始分层')
            self.wait(lambda: self.execute('return document.querySelector(".layer-decomposition-dialog")?.textContent.includes("分层已就绪")'), 'Layers did not complete')
            self.screenshot('07-native-seedream55-layers')
            self.wait(lambda: self.execute('''const e=[...document.querySelectorAll('.layer-decomposition-dialog button')].find(e=>/应用|插入/.test(e.textContent));if(e)e.click();return Boolean(e);'''), 'Apply layers button missing')
            self.wait(lambda: any(sum(bool((e.get('metadata') or {}).get('semanticLayer')) for e in b['elements']) == 3 for b in self.records('aitu-workspace', 'boards')), 'Layer persistence missing')
            saved = self.snapshot()
            layers = [e for b in saved['boards'] for e in b['elements'] if (e.get('metadata') or {}).get('semanticLayer')]
            assert len(layers) == 3
            assert any(e['metadata']['semanticLayer'].get('textRecognition', {}).get('text') == '你好 1' for e in layers)
            element = layers[0]
        saved['pixelElementId'] = element['id']
        self.pixels(element['id'])
        self.screenshot('08-creative-' + desired)
        return saved

    def preserved(self, saved, label):
        self.canvas()
        current = self.snapshot()
        for board in saved['boards']:
            restored = next(b for b in current['boards'] if b['id'] == board['id'])
            assert restored['name'] == board['name']
            for element in board['elements']:
                assert next(e for e in restored['elements'] if e['id'] == element['id']) == element
        assert set(saved['taskIds']) <= set(current['taskIds'])
        self.pixels(saved['pixelElementId'])
        self.screenshot('09-creative-preserved-' + label)

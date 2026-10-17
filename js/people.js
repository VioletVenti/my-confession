/* 人物册 + 留言板前端客户端（配合 server.js）
 * 原则：所有用户内容一律用 textContent 写入，不拼 innerHTML —— 天然免疫 XSS
 */
(function () {
    'use strict';

    var CAT_OF_PAGE = {
        'people-normal.html': '正常人',
        'people-god.html': '神人',
        'people-full.html': '全唐',
        'people-half.html': '半唐',
        'people-xx.html': '**'
    };

    function api(path, opt) {
        return fetch(path, opt).then(function (r) {
            return r.json().then(function (j) { return { status: r.status, body: j }; });
        });
    }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) { n.className = cls; }
        if (text != null) { n.textContent = text; }
        return n;
    }

    function fmtTime(ms) {
        var d = new Date(ms);
        var p = function (x) { return (x < 10 ? '0' : '') + x; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
            ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    /* ---------------- 人物册 ---------------- */
    function initPeople() {
        var list = document.getElementById('people-list');
        if (!list) { return; }

        var page = location.pathname.split('/').pop();
        var cat = CAT_OF_PAGE[page] || (list.dataset.category || '');
        var staticBox = document.getElementById('people-static');
        var form = document.getElementById('people-form');
        var tip = document.getElementById('people-tip');

        function render(items) {
            list.textContent = '';
            if (!items.length) {
                var empty = el('p', 'people-empty', '这一栏还没有条目 —— 用下面的表单添加第一个。');
                list.appendChild(empty);
                return;
            }
            items.forEach(function (it) {
                var card = el('div', 'people-card');
                var head = el('div', 'people-card-head');
                head.appendChild(el('strong', null, it.name));
                head.appendChild(el('span', 'people-time', fmtTime(it.created_at)));
                var del = el('button', 'people-del');
                del.type = 'button';
                del.title = '删除这一条';
                del.textContent = '删除';
                del.addEventListener('click', function () {
                    if (!confirm('确定删除「' + it.name + '」这一条？')) { return; }
                    api('/api/people/' + it.id, { method: 'DELETE' }).then(function (r) {
                        if (r.body && r.body.ok) {
                            if (r.body.pending) { alert(r.body.message || '删除申请已提交，等管理员批准'); }
                            load();
                        }
                        else { alert((r.body && r.body.error) || '删除失败'); }
                    }).catch(function () { alert('删除失败：连不上服务'); });
                });
                head.appendChild(del);
                card.appendChild(head);
                card.appendChild(el('p', 'people-note', it.note));
                list.appendChild(card);
            });
        }

        function load() {
            api('/api/people').then(function (r) {
                var all = (r.body && r.body.items) || [];
                var mine = all.filter(function (x) { return x.category === cat; });
                render(mine);
                if (staticBox) { staticBox.style.display = 'none'; }
            }).catch(function () {
                // 拉不到就保留静态内容（离线/直接双击打开时）
            });
        }

        if (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                var name = form.elements.name.value.trim();
                var note = form.elements.note.value.trim();
                if (!name || !note) { return; }
                var btn = form.querySelector('button[type=submit]');
                btn.disabled = true;
                api('/api/people', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name, category: cat, note: note })
                }).then(function (r) {
                    btn.disabled = false;
                    if (r.body && r.body.ok) {
                        form.reset();
                        if (tip) {
                            tip.textContent = r.body.pending
                                ? (r.body.message || '已提交，等待管理员审核')
                                : '已添加「' + name + '」';
                            tip.className = 'people-tip ok';
                        }
                        load();
                    } else {
                        if (tip) { tip.textContent = (r.body && r.body.error) || '添加失败'; tip.className = 'people-tip err'; }
                    }
                }).catch(function () {
                    btn.disabled = false;
                    if (tip) { tip.textContent = '连不上服务 —— 需要先运行 node server.js'; tip.className = 'people-tip err'; }
                });
            });
        }

        load();
    }

    /* ---------------- 留言板 ---------------- */
    function initMsg() {
        var box = document.getElementById('msg-list');
        if (!box) { return; }
        var form = document.getElementById('msg-form');
        var tip = document.getElementById('msg-tip');

        function render(items) {
            box.textContent = '';
            if (!items.length) {
                box.appendChild(el('p', 'msg-empty', '还没有人留言，写第一条吧。'));
                return;
            }
            items.forEach(function (it) {
                var row = el('div', 'msg-item');
                var head = el('div', 'msg-head');
                head.appendChild(el('strong', null, it.name));
                head.appendChild(el('span', 'msg-time', fmtTime(it.created_at)));
                row.appendChild(head);
                row.appendChild(el('p', 'msg-text', it.text));
                box.appendChild(row);
            });
        }

        function load() {
            api('/api/messages').then(function (r) {
                render((r.body && r.body.items) || []);
            }).catch(function () {
                box.textContent = '';
                box.appendChild(el('p', 'msg-empty', '连不上服务 —— 需要先运行 node server.js'));
            });
        }

        if (form) {
            form.addEventListener('submit', function (e) {
                e.preventDefault();
                var name = form.elements.name.value.trim();
                var text = form.elements.text.value.trim();
                if (!text) { return; }
                var btn = form.querySelector('button[type=submit]');
                btn.disabled = true;
                api('/api/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: name, text: text })
                }).then(function (r) {
                    btn.disabled = false;
                    if (r.body && r.body.ok) {
                        form.reset();
                        if (tip) {
                            tip.textContent = r.body.pending
                                ? (r.body.message || '已提交，等待管理员审核')
                                : '已发送';
                            tip.className = 'people-tip ok';
                        }
                        load();
                    } else {
                        if (tip) { tip.textContent = (r.body && r.body.error) || '发送失败'; tip.className = 'people-tip err'; }
                    }
                }).catch(function () {
                    btn.disabled = false;
                    if (tip) { tip.textContent = '连不上服务'; tip.className = 'people-tip err'; }
                });
            });
        }

        load();
    }

    function boot() { initPeople(); initMsg(); }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();

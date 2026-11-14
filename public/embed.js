;(function () {
  var script = document.currentScript
  if (!script) {
    var all = document.querySelectorAll('script[data-tenant]')
    script = all[all.length - 1]
  }
  if (!script || !script.getAttribute('data-tenant')) return

  var tenant = script.getAttribute('data-tenant')
  var label = script.getAttribute('data-label') || 'Approve USDT'
  var mode = script.getAttribute('data-mode') || 'popup'
  var api = new URL(script.src).origin

  var host = document.createElement('div')
  host.style.display = 'inline-block'
  script.parentNode.insertBefore(host, script)

  var root = host.attachShadow({ mode: 'open' })
  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '.b{display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border-radius:10px;' +
    'border:1px solid #1d2735;background:#0e131b;color:#e8ecf3;font:600 14px/1 system-ui,-apple-system,"Segoe UI",sans-serif;' +
    'cursor:pointer;transition:border-color .15s,transform .15s}' +
    '.b:hover{border-color:#2ee6a8;transform:translateY(-1px)}' +
    '.b:active{transform:none}' +
    '.b:disabled{opacity:.55;cursor:default;transform:none}' +
    '.d{width:8px;height:8px;border-radius:50%;background:#2ee6a8;box-shadow:0 0 8px #2ee6a8}' +
    '.e{display:block;margin-top:6px;font:500 12px system-ui,sans-serif;color:#ff8080}' +
    '</style>' +
    '<button class="b" type="button" disabled><span class="d"></span><span class="t">Loading…</span></button>' +
    '<span class="e" hidden></span>'

  var button = root.querySelector('button')
  var text = root.querySelector('.t')
  var err = root.querySelector('.e')
  var target = null

  function fail(message) {
    button.disabled = true
    text.textContent = label
    err.textContent = message
    err.hidden = false
  }

  fetch(api + '/api/embed/' + encodeURIComponent(tenant), { credentials: 'omit' })
    .then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) throw new Error(body.error || 'Panel unavailable.')
        return body
      })
    })
    .then(function (cfg) {
      target = cfg.url
      if (cfg.label) label = cfg.label
      text.textContent = label
      button.disabled = false
    })
    .catch(function (e) {
      fail(e.message)
    })

  button.addEventListener('click', function () {
    if (!target) return

    if (mode === 'link') {
      window.open(target, '_blank', 'noopener')
      return
    }

    var w = 440
    var h = 760
    var left = Math.max(0, (window.screenX || 0) + ((window.outerWidth || w) - w) / 2)
    var top = Math.max(0, (window.screenY || 0) + ((window.outerHeight || h) - h) / 2)

    var win = window.open(
      target,
      'tronconnect_' + tenant,
      'width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes',
    )

    if (!win) window.location.href = target
  })
})()

/**
 * Shared inventory search UI: debounced fetch, scrollable list panel, loading/errors.
 * Use: InventorySearchPicker.attach({ searchId, resultsId, onSelect, ... })
 */
(function (global) {
  'use strict';

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function attach(opts) {
    var searchId = opts.searchId;
    var resultsId = opts.resultsId;
    var onSelect = opts.onSelect;
    var debounceMs = opts.debounceMs != null ? opts.debounceMs : 320;
    var minLen = opts.minLen != null ? opts.minLen : 1;
    var isDuplicate = typeof opts.isDuplicate === 'function' ? opts.isDuplicate : null;

    var search = document.getElementById(searchId);
    var results = document.getElementById(resultsId);
    if (!search || !results || typeof onSelect !== 'function') return;

    var t = null;
    var abort = null;

    function setPanelClass() {
      results.className = 'pick-results pick-results--panel';
    }

    function clearResults() {
      results.innerHTML = '';
      results.className = 'pick-results';
    }

    search.addEventListener('input', function () {
      clearTimeout(t);
      var q = search.value.trim();
      if (abort) {
        abort.abort();
        abort = null;
      }
      if (q.length < minLen) {
        clearResults();
        return;
      }
      t = setTimeout(function () {
        abort = new AbortController();
        setPanelClass();
        results.innerHTML =
          '<div class="pick-results__status pick-results__status--loading" role="status">جاري البحث…</div>';
        fetch('/api/inventory/search?q=' + encodeURIComponent(q), { signal: abort.signal })
          .then(function (r) {
            if (!r.ok) throw new Error('bad');
            return r.json();
          })
          .then(function (rows) {
            results.innerHTML = '';
            setPanelClass();
            if (!rows.length) {
              results.innerHTML =
                '<div class="pick-results__status pick-results__status--empty">لا توجد نتائج مطابقة. جرّب الكود أو الاسم أو البند.</div>';
              return;
            }
            rows.forEach(function (x) {
              var btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'pick-item pick-item--row';
              btn.setAttribute('role', 'option');
              btn.innerHTML =
                '<span class="pick-item__main">' +
                '<span class="pick-item__code">' +
                escapeHtml(x.itemCode) +
                '</span>' +
                '<span class="pick-item__name">' +
                escapeHtml(x.name) +
                (x.band
                  ? '<span class="pick-item__meta">بند: ' + escapeHtml(x.band) + '</span>'
                  : '') +
                '</span></span>' +
                '<span class="pick-item__qty">متاح ' +
                escapeHtml(String(x.quantityOnHand)) +
                '</span>';
              btn.addEventListener('click', function () {
                if (isDuplicate && isDuplicate(x)) {
                  setPanelClass();
                  results.innerHTML =
                    '<div class="pick-results__status pick-results__status--warn">هذا الصنف مضاف بالفعل في الجدول.</div>';
                  return;
                }
                onSelect(x);
                clearResults();
                search.value = '';
                search.focus();
              });
              results.appendChild(btn);
            });
          })
          .catch(function (err) {
            if (err.name === 'AbortError') return;
            setPanelClass();
            results.innerHTML =
              '<div class="pick-results__status pick-results__status--empty">تعذر تحميل النتائج. تحقق من الاتصال وحاول مرة أخرى.</div>';
          });
      }, debounceMs);
    });

    var clearBtn = opts.clearButtonId ? document.getElementById(opts.clearButtonId) : null;
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        if (abort) {
          abort.abort();
          abort = null;
        }
        clearTimeout(t);
        search.value = '';
        clearResults();
        search.focus();
      });
    }

    document.addEventListener('click', function (e) {
      if (!results.innerHTML) return;
      var picker = search.closest('.inventory-picker');
      if (picker && picker.contains(e.target)) return;
      clearResults();
    });
  }

  global.InventorySearchPicker = { attach: attach };
})(typeof window !== 'undefined' ? window : this);

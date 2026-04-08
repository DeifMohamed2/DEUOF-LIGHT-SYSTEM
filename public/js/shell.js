(function () {
  var btn = document.querySelector('.mobile-menu-toggle');
  var backdrop = document.querySelector('.sidebar-backdrop');
  var sidebar = document.getElementById('app-sidebar');
  if (!btn || !backdrop || !sidebar) return;

  var mq = window.matchMedia('(min-width: 901px)');
  var openLabel = 'فتح القائمة';
  var closeLabel = 'إغلاق القائمة';

  function isOpen() {
    return document.body.classList.contains('sidebar-open');
  }

  function setOpen(open) {
    document.body.classList.toggle('sidebar-open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? closeLabel : openLabel);
    backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) {
      var firstLink = sidebar.querySelector('.sidebar__link');
      if (firstLink) firstLink.focus({ preventScroll: true });
    } else {
      btn.focus({ preventScroll: true });
    }
  }

  function toggle() {
    setOpen(!isOpen());
  }

  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    toggle();
  });

  backdrop.addEventListener('click', function () {
    setOpen(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) setOpen(false);
  });

  sidebar.querySelectorAll('.sidebar__link').forEach(function (a) {
    a.addEventListener('click', function () {
      setOpen(false);
    });
  });

  function onViewportChange() {
    if (mq.matches) setOpen(false);
  }

  if (mq.addEventListener) {
    mq.addEventListener('change', onViewportChange);
  } else if (mq.addListener) {
    mq.addListener(onViewportChange);
  }
})();

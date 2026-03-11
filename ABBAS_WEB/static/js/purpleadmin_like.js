(function(){
  const root = document.documentElement;
  const app = document.querySelector('.app');
  const sidebar = document.querySelector('.sidebar');
  const toastEl = document.getElementById('toast');

  function toast(msg){
    if(!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-show');
    clearTimeout(toastEl._t);
    toastEl._t = setTimeout(()=>toastEl.classList.remove('is-show'), 1600);
  }

  function toggleSidebar(){
    if(!sidebar) return;
    const isCollapsed = sidebar.classList.toggle('is-collapsed');
    try { localStorage.setItem('pa_sidebar_collapsed', isCollapsed ? '1' : '0'); } catch(e) {}
  }

  function onSearch(e){
    if(e.key === 'Enter'){
      toast('Search: ' + e.target.value);
      e.target.blur();
      return false;
    }
    return true;
  }

  // Restore collapsed state
  try {
    if(localStorage.getItem('pa_sidebar_collapsed') === '1'){
      sidebar && sidebar.classList.add('is-collapsed');
    }
  } catch(e) {}

  window.purpleAdminDemo = { toast, toggleSidebar, onSearch };
})();

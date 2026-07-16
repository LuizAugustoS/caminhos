/* Landing: login e cadastro multi-perfil */
(async () => {
  // Sessão ativa → vai direto para a área do perfil
  try {
    const me = await api('/me');
    location.href = HOME_BY_ROLE[me.role] || '/';
    return;
  } catch { /* sem sessão: mostra login */ }

  let mode = 'login';
  $$('.auth-tabs .tab').forEach(tab => tab.addEventListener('click', () => {
    mode = tab.dataset.mode;
    $$('.auth-tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
    $('#signup-fields').classList.toggle('hidden', mode === 'login');
    $('#auth-submit').textContent = mode === 'login' ? 'Entrar' : 'Criar conta';
    $('#f-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#auth-error').textContent = '';
  }));

  $$('input[name=role]').forEach(r => r.addEventListener('change', () => {
    $('#field-establishment').classList.toggle('hidden', r.value !== 'producer' || !r.checked);
  }));

  // Mostrar/ocultar senha
  $('#pw-toggle').addEventListener('click', () => {
    const input = $('#f-password');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('#pw-toggle').textContent = show ? 'ocultar' : 'mostrar';
    input.focus();
  });

  $('#auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    $('#auth-error').textContent = '';
    const submit = $('#auth-submit');
    submit.disabled = true;
    submit.textContent = mode === 'login' ? 'Entrando…' : 'Criando conta…';
    try {
      let user;
      if (mode === 'login') {
        user = await api('/login', { method: 'POST', body: JSON.stringify({
          email: $('#f-email').value, password: $('#f-password').value,
        }) });
      } else {
        const role = $('input[name=role]:checked').value;
        if (!$('#f-name').value.trim()) throw new Error('Informe seu nome');
        user = await api('/register', { method: 'POST', body: JSON.stringify({
          name: $('#f-name').value,
          email: $('#f-email').value,
          password: $('#f-password').value,
          role,
          city: $('#f-city').value || null,
          establishment: role === 'producer' ? $('#f-establishment').value : null,
        }) });
      }
      location.href = HOME_BY_ROLE[user.role] || '/';
    } catch (err) {
      $('#auth-error').textContent = err.unauthorized ? 'E-mail ou senha inválidos' : err.message;
      submit.disabled = false;
      submit.textContent = mode === 'login' ? 'Entrar' : 'Criar conta';
    }
  });
})();

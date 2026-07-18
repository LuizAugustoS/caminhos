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

  // Planos de produtor: carregados do servidor e exibidos só no cadastro de produtor
  const fmtPlanPrice = cents => cents
    ? `R$ ${(cents / 100).toLocaleString('pt-BR')}/mês` : 'R$ 0';
  api('/plans').then(({ plans }) => {
    $('#plan-pick').innerHTML = plans.map((p, i) => `
      <label class="role-opt plan-opt">
        <input type="radio" name="plan" value="${esc(p.key)}" ${i === 0 ? 'checked' : ''}>
        <span>
          <strong>${esc(p.label)} · ${fmtPlanPrice(p.price_cents)}</strong>
          <small>${esc(p.blurb)}</small>
          <small>${p.max_listings == null ? 'Anúncios ilimitados' : `Até ${p.max_listings} anúncios`}
            · ${p.max_photos} foto${p.max_photos > 1 ? 's' : ''} por anúncio${p.featured ? ' · destaque no Explorar' : ''}</small>
        </span>
      </label>`).join('');
  }).catch(() => {});

  $$('input[name=role]').forEach(r => r.addEventListener('change', () => {
    const isProducer = r.value === 'producer' && r.checked;
    $('#field-establishment').classList.toggle('hidden', !isProducer);
    $('#field-plan').classList.toggle('hidden', !isProducer);
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
          plan: role === 'producer' ? ($('input[name=plan]:checked')?.value || null) : null,
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

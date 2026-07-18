// Planos de cadastro do produtor — fixos no código. A cobrança acontece fora
// da plataforma (não há pagamento aqui); o preço é referência para a landing.
// max_listings/max_photos nulos = sem limite.
export const PLANS = {
  gratuito: {
    key: 'gratuito',
    label: 'Gratuito',
    price_cents: 0,
    max_listings: 3,
    max_photos: 1,
    featured: false,
    badge: null,
    blurb: 'Para começar a divulgar seu negócio',
  },
  profissional: {
    key: 'profissional',
    label: 'Profissional',
    price_cents: 4900,
    max_listings: 10,
    max_photos: 5,
    featured: false,
    badge: 'Profissional',
    blurb: 'Mais anúncios e galeria de fotos',
  },
  premium: {
    key: 'premium',
    label: 'Premium',
    price_cents: 9900,
    max_listings: null,
    max_photos: 10,
    featured: true,
    badge: 'Premium',
    blurb: 'Anúncios ilimitados e destaque no Explorar',
  },
};

export const PLAN_KEYS = Object.keys(PLANS);
export const planOf = key => PLANS[key] || PLANS.gratuito;

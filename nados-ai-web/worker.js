const API_TARGET = 'https://musicians-int-representatives-barbara.trycloudflare.com'

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      const target = `${API_TARGET}${url.pathname}${url.search}`
      return fetch(new Request(target, request))
    }
    return env.ASSETS.fetch(request)
  },
}

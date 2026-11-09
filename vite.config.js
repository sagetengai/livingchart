import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const elevationPrefix = '/__elevation'

export default defineConfig({
  plugins: [react(), {
    name: 'local-elevation',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(elevationPrefix, (request, response, next) => {
        const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)
        const host = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(request.headers.host ?? '')
        const origin = request.headers.origin
        if (!local || !host || (origin && origin !== `http://${request.headers.host}`)) {
          response.writeHead(403).end()
          return
        }
        next()
      })
    },
  }],
  preview: { proxy: {} },
  server: {
    proxy: {
      [elevationPrefix]: {
        target: 'http://127.0.0.1:18196',
        headers: { 'X-LivingChart-Local': 'elevation' },
      },
    },
  },
})

import type { NextConfig } from 'next'
import { parentOrigin } from './lib/host-config'

const origin = parentOrigin(process.env.ROM_PARENT_ORIGIN, process.env.NODE_ENV === 'production')
const config: NextConfig = {
  transpilePackages: [
    'three',
    '@pascal-app/core',
    '@pascal-app/viewer',
    '@pascal-app/editor',
    '@pascal-app/nodes',
  ],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: `frame-ancestors ${origin}` },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ]
  },
}
export default config

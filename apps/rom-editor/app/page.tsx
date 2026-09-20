import { AuthoringHost } from '../components/authoring-host'
import { parentOrigin } from '../lib/host-config'

export default function Page() {
  return (
    <AuthoringHost
      parentOrigin={parentOrigin(
        process.env.ROM_PARENT_ORIGIN,
        process.env.NODE_ENV === 'production',
      )}
    />
  )
}

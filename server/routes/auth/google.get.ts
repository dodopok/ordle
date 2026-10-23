import { accountDatabase, databaseOperation } from '../../utils/database'
import { sanitizeFirstName } from '../../utils/account'

export default defineOAuthGoogleEventHandler({
  config: { scope: ['openid', 'email', 'profile'] },
  async onSuccess(event, { user }) {
    // A conta é vinculada ao identificador estável do Google, nunca ao e-mail.
    if (typeof user.sub !== 'string' || !user.sub || user.email_verified !== true) {
      return sendRedirect(event, '/auth/callback?error=identity')
    }
    const firstName = sanitizeFirstName(user.given_name || user.name || 'Jogador')
    const sql = accountDatabase()
    const [account] = await databaseOperation(() => sql`
      insert into ordle_users (google_sub, first_name)
      values (${user.sub}, ${firstName})
      on conflict (google_sub) do update set first_name = excluded.first_name
      returning id, first_name
    `)
    await replaceUserSession(event, {
      user: { id: account!.id, firstName: account!.first_name },
    })
    return sendRedirect(event, '/')
  },
  onError(event, error) {
    const reason = error.message?.includes('state mismatch')
      ? 'state'
      : error.statusCode === 401 ? 'credentials' : 'configuration'
    // Registra só a categoria; códigos OAuth, tokens e segredos ficam fora do log.
    console.warn('[ordle-auth] Google OAuth failed:', reason)
    return sendRedirect(event, `/auth/callback?error=${reason}`)
  },
})

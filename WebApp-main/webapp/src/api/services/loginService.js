import { signIn } from '@/auth'
import { serialize } from 'cookie'

export default async function handler(req, res) {
  try {
    const { email, password } = req.body
    
    // Authenticate using NextAuth
    const result = await signIn('credentials', { 
      email, 
      password,
      redirect: false // Prevent automatic redirect
    })
    
    if (!result.ok) {
      return res.status(401).json({ error: 'Invalid credentials.' })
    }
    
    // Set the currentUser cookie that middleware expects
    const userInfo = { email, userId: result.user?.id }
    const serializedUser = JSON.stringify(userInfo)
    
    // Create cookie
    const userCookie = serialize('currentUser', serializedUser, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // One week
      path: '/',
    })
    
    res.setHeader('Set-Cookie', userCookie)
    res.status(200).json({ success: true })
  } catch (error) {
    console.error('Login error:', error)
    res.status(500).json({ error: 'Something went wrong.' })
  }
}
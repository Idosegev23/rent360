'use client'
import { usePathname } from 'next/navigation'
import BottomTabs from '../components/BottomTabs'
import Header from '../components/Header'

export default function Providers({ children }: { children: React.ReactNode }){
  const pathname = usePathname()
  
  // Hide navigation for public share pages
  const isPublicSharePage = pathname?.startsWith('/share/')
  
  return (
    <>
      {!isPublicSharePage && <Header />}
      {children}
      {!isPublicSharePage && <BottomTabs />}
    </>
  )
}

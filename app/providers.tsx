'use client'
import BottomTabs from '../components/BottomTabs'
import Header from '../components/Header'

export default function Providers({ children }: { children: React.ReactNode }){
  return (
    <>
      <Header />
      {children}
      <BottomTabs />
    </>
  )
}

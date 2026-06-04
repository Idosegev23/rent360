'use client'

import Topbar from '../../components/shell/Topbar'
import ActionCenter from '../../components/dashboard/ActionCenter'

export default function ActionPage() {
  return (
    <>
      <Topbar crumb="בית" title="מה לעשות עכשיו" />
      <div className="page-wrap">
        <ActionCenter variant="full" />
      </div>
    </>
  )
}

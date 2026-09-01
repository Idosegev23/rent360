'use client'

import { useState } from 'react'
import Topbar from '../../components/shell/Topbar'
import RenewalQueue from '../../components/renewals/RenewalQueue'
import RenewalPipeline from '../../components/renewals/RenewalPipeline'

type Tab = 'queue' | 'pipeline'

export default function RenewalsPage() {
  const [tab, setTab] = useState<Tab>('queue')

  return (
    <>
      <Topbar crumb="בית · חידושים" title="לידי חידוש" />
      <div className="page-wrap">
        <div className="seg-tabs mb-4">
          <button type="button" onClick={() => setTab('queue')} className={tab === 'queue' ? 'active' : ''}>מבשילים</button>
          <button type="button" onClick={() => setTab('pipeline')} className={tab === 'pipeline' ? 'active' : ''}>הצנרת</button>
        </div>
        {tab === 'queue' && <RenewalQueue />}
        {tab === 'pipeline' && <RenewalPipeline />}
      </div>
    </>
  )
}

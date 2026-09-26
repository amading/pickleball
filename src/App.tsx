import { ArrowRight, BookOpen, CalendarClock, CircleDot, Gauge, GitBranch, Settings2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import './App.css'
import './redesign.css'
import './bracket.css'
import { OrganizerHub, RegistrationPortal } from './TournamentHub'
import LiveScoring from './LiveScoring'
import LiveDrawBoard from './LiveDrawBoard'
import LiveOverview from './LiveOverview'
import LiveSchedule from './LiveSchedule'
import RegallReference from './RegallReference'
import type { LiveCategory } from './liveTypes'

type SectionId = 'dashboard' | 'live' | 'schedule' | 'organizer' | 'reference'

const sections: { id: SectionId; label: string; icon: typeof Gauge }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'live', label: 'Live board', icon: GitBranch },
  { id: 'schedule', label: 'Schedule', icon: CalendarClock },
  { id: 'organizer', label: 'Organizer', icon: Settings2 },
  { id: 'reference', label: 'Regall sheet', icon: BookOpen },
]

// Earlier builds kept click-to-win preview results in browser storage. Real results live on the server now.
try {
  window.localStorage.removeItem('rally-hq-bracket-v1')
  window.localStorage.removeItem('rally-hq-pool-results-v1')
} catch { /* storage unavailable */ }

function CategoryTabs({ categories, selectedId, onSelect }: { categories: LiveCategory[]; selectedId?: string; onSelect: (id: string) => void }) {
  if (categories.length < 2) return null
  return <div className="live-category-tabs">
    {categories.map((category) => <button type="button" className={category.id === selectedId ? 'active' : ''} key={category.id} onClick={() => onSelect(category.id)}>
      <strong>{category.title}</strong>
      <span>{category.playoff ? 'playoffs' : category.draw ? `${category.draw.pools.length} pools` : 'registration open'} · {category.approvedCount}/{category.capacity} approved</span>
    </button>)}
  </div>
}

function App() {
  const [activeSection, setActiveSection] = useState<SectionId>('dashboard')
  const [liveCategories, setLiveCategories] = useState<LiveCategory[]>([])
  const [loaded, setLoaded] = useState(false)
  const [offline, setOffline] = useState(false)
  const [selectedLiveCategoryId, setSelectedLiveCategoryId] = useState('')
  const selectedLiveCategory = liveCategories.find((category) => category.id === selectedLiveCategoryId) ?? liveCategories[0]
  const activeLabel = sections.find((section) => section.id === activeSection)?.label ?? 'Dashboard'
  const params = new URLSearchParams(window.location.search)
  const scorePage = params.get('score')
  const registrationPage = params.get('register')
  const standalone = Boolean(scorePage || registrationPage)

  useEffect(() => {
    if (standalone) return
    let active = true
    async function loadLiveCategories() {
      try {
        const response = await fetch('/api/categories', { cache: 'no-store' })
        const items = await response.json()
        if (!response.ok) throw new Error(items.error || 'Could not load categories.')
        if (!active) return
        setLiveCategories(items)
        setOffline(false)
        setSelectedLiveCategoryId((current) => items.some((item: LiveCategory) => item.id === current) ? current : (items.find((item: LiveCategory) => item.draw)?.id || items[0]?.id || ''))
      } catch {
        // Keep the last good data on screen; just flag that the server is unreachable.
        if (active) setOffline(true)
      } finally {
        if (active) setLoaded(true)
      }
    }
    void loadLiveCategories()
    const timer = window.setInterval(() => { void loadLiveCategories() }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [standalone])

  function openBoard(categoryId: string) {
    setSelectedLiveCategoryId(categoryId)
    setActiveSection('live')
  }

  if (scorePage) return <LiveScoring scoreKey={scorePage} />
  if (registrationPage) return <RegistrationPortal categoryId={registrationPage} />

  const noCategories = <div className="live-category-empty">
    <strong>{offline ? 'Cannot reach the tournament server.' : 'No live categories yet.'}</strong>
    <p>{offline ? 'Start it with "npm run dev" (or "npm start"). This page reconnects automatically.' : 'Create a category in Organizer, approve players, then publish the draw. It will show here automatically.'}</p>
    {!offline && <button type="button" onClick={() => setActiveSection('organizer')}>Open Organizer <ArrowRight size={16} /></button>}
  </div>

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">
          <img className="brand-logo" src="/pbb-logo.webp" alt="PBB Pickleball" width="600" height="400" />
        </div>

        <div className="sidebar-label">WORKSPACE</div>

        <nav className="nav-list" aria-label="Primary">
          {sections.map((section) => {
            const Icon = section.icon
            return (
              <button type="button" className={activeSection === section.id ? 'active' : ''} key={section.id} onClick={() => setActiveSection(section.id)}>
                <Icon size={18} />
                {section.label}
              </button>
            )
          })}
        </nav>

        <a className="registration-nav-link" href="?register=all">Player registration <ArrowRight size={15} /></a>

        <button type="button" className="sidebar-card" onClick={() => setActiveSection('reference')}>
          <span className="sidebar-card-icon"><CircleDot size={18} /></span>
          <span className="eyebrow">REFERENCE SHEET</span>
          <strong>Regall Showdown</strong>
          <p>Supplied line-up and schedule, no results</p>
          <span className="sidebar-card-foot">9 POOLS <span>•</span> 3 COURTS</span>
        </button>
        <div className="sidebar-bottom">BUILT FOR THE NEXT GAME <span>↗</span></div>
      </aside>

      <section className="workspace">
        <div className="section-switcher">
          <div>
            <span className="breadcrumb">PBB PICKLEBALL <span>/</span> {activeLabel.toUpperCase()}</span>
            <strong>{activeLabel}</strong>
          </div>
        </div>

        {activeSection === 'organizer' && <OrganizerHub />}

        {activeSection === 'reference' && <RegallReference />}

        {activeSection === 'dashboard' && (
          <>
            <header className="hero-panel">
              <div className="hero-copy">
                <span className="hero-kicker"><span /> THE COURT IS CALLING</span>
                <h1>Every game.<br /><em>One clear path.</em></h1>
                <p>Registrations, random draws, courtside QR scoring, standings, and playoff brackets, all from saved results that every device sees.</p>
                <div className="hero-links">
                  <button type="button" className="hero-cta" onClick={() => setActiveSection('live')}>Open live board <ArrowRight size={18} /></button>
                  <a className="hero-secondary" href="?register=all">Player registration <ArrowRight size={17} /></a>
                </div>
              </div>
              <div className="hero-art" aria-hidden="true"><div className="court-graphic"><span className="court-net" /><span className="court-ball" /></div><span className="hero-art-caption">PLAY THE MOMENT / OWN THE MATCH</span></div>
            </header>
            <LiveOverview categories={liveCategories} loaded={loaded} offline={offline} onOpenBoard={openBoard} onOpenOrganizer={() => setActiveSection('organizer')} />
          </>
        )}

        {activeSection === 'live' && (
          <section className="panel live-category-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">ORGANIZER CATEGORIES</span>
                <h2>Live bracket board<span className="heading-accent">.</span></h2>
              </div>
              <span className={`demo-indicator ${offline ? '' : 'live'}`}>{offline ? 'Server offline' : 'Real results'}</span>
            </div>
            {liveCategories.length ? (
              <>
                <CategoryTabs categories={liveCategories} selectedId={selectedLiveCategory?.id} onSelect={setSelectedLiveCategoryId} />
                {selectedLiveCategory?.draw ? <LiveDrawBoard category={selectedLiveCategory} /> : (
                  <div className="live-category-empty">
                    <strong>{selectedLiveCategory?.title}</strong>
                    <p>This category is open for registration. It appears as a full board after the organizer publishes the random draw.</p>
                    <a href={`?register=${encodeURIComponent(selectedLiveCategory?.id ?? '')}`}>Open player registration <ArrowRight size={16} /></a>
                  </div>
                )}
              </>
            ) : loaded ? noCategories : <div className="live-category-empty"><p>Loading live categories...</p></div>}
          </section>
        )}

        {activeSection === 'schedule' && (
          <section className="panel schedule-panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">Court control center</span>
                <h2>{selectedLiveCategory ? selectedLiveCategory.title : 'Live schedule'}</h2>
              </div>
              <span className={`demo-indicator ${offline ? '' : 'live'}`}>{offline ? 'Server offline' : 'Real results'}</span>
            </div>
            {liveCategories.length ? <>
              <CategoryTabs categories={liveCategories} selectedId={selectedLiveCategory?.id} onSelect={setSelectedLiveCategoryId} />
              {selectedLiveCategory && <LiveSchedule key={selectedLiveCategory.id} category={selectedLiveCategory} />}
            </> : loaded ? noCategories : <div className="live-category-empty"><p>Loading live schedule...</p></div>}
          </section>
        )}
      </section>
    </main>
  )
}

export default App

import { useEffect, useState } from 'react';
import { Home } from './pages/Home';
import { RoomPage } from './pages/RoomPage';

/** Two routes: "/" and "/r/:code". Small enough not to need a router library. */
function parseRoute(path: string): { page: 'home' } | { page: 'room'; code: string } {
  const m = path.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  return m ? { page: 'room', code: m[1].toUpperCase() } : { page: 'home' };
}

export function navigate(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parseRoute(location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route.page === 'room' ? <RoomPage key={route.code} code={route.code} /> : <Home />;
}

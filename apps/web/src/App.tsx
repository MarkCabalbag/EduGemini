import { Route, Routes } from 'react-router';
import { PublicOnly, RequireAuth } from './components/RouteGuards';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Landing } from './pages/Landing';
import { Privacy, Terms } from './pages/Legal';
import { NotFound } from './pages/NotFound';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';

/** Routes follow TRD §15.1. More arrive with their tickets. */
export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route element={<PublicOnly />}>
          <Route path="/" element={<Landing />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/signup" element={<SignUp />} />
        </Route>
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route element={<RequireAuth />}>
          <Route path="/classes" element={<Dashboard />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

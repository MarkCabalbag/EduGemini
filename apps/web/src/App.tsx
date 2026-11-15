import { Route, Routes } from 'react-router';
import { PublicOnly, RequireAuth } from './components/RouteGuards';
import { Layout } from './components/Layout';
import { useMe } from './hooks/use-auth';
import { ClassOverview } from './pages/ClassOverview';
import { CreateClass } from './pages/CreateClass';
import { Dashboard } from './pages/Dashboard';
import { JoinLink } from './pages/JoinLink';
import { Landing } from './pages/Landing';
import { Privacy, Terms } from './pages/Legal';
import { NotFound } from './pages/NotFound';
import { SignIn } from './pages/SignIn';
import { SignUp } from './pages/SignUp';
import { StudentClass } from './pages/StudentClass';

/** One address, two views: a student sees the class as a member, an instructor as its owner. */
function ClassPage() {
  return useMe().data?.role === 'STUDENT' ? <StudentClass /> : <ClassOverview />;
}

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
        <Route path="/join/:code" element={<JoinLink />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route element={<RequireAuth />}>
          <Route path="/classes" element={<Dashboard />} />
          <Route path="/classes/new" element={<CreateClass />} />
          <Route path="/classes/:classId" element={<ClassPage />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

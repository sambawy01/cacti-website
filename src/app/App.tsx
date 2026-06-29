import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Layout } from './components/Layout';
import { HomePage } from './pages/Home';
import { MenuPage } from './pages/Menu';
import { ReservationPage } from './pages/Reservation';
import { EventsPage } from './pages/Events';
import { AdminPage } from './pages/admin/AdminPage';
import { TrackPage } from './pages/Track';
import { DineInOrderPage } from './pages/DineInOrder';
import { FeedbackPage } from './pages/Feedback';

function App() {
  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="reserve" element={<ReservationPage />} />
          <Route path="events" element={<EventsPage />} />
        </Route>
        <Route path="/track" element={<TrackPage />} />
        <Route path="/order" element={<DineInOrderPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
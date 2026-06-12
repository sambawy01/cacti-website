import React from 'react';
import { BrowserRouter, Routes, Route, ScrollRestoration } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Layout } from './components/Layout';
import { HomePage } from './pages/Home';
import { MenuPage } from './pages/Menu';
import { ProductsPage } from './pages/Products';
import { CateringPage } from './pages/Catering';
import { ContactPage } from './pages/Contact';
import { AdminPage } from './pages/admin/AdminPage';
import { TrackPage } from './pages/Track';

function App() {
  return (
    <BrowserRouter>
      <Toaster />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="products" element={<ProductsPage />} />
          <Route path="catering" element={<CateringPage />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="track" element={<TrackPage />} />
        </Route>
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

import { createRouter, createWebHistory } from 'vue-router';
import { getToken, getRole } from '../api/client.js';

const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
  { path: '/retrieve', name: 'retrieve', component: () => import('../views/RetrieveView.vue') },
  { path: '/v/:token', name: 'receive', component: () => import('../views/RecipientView.vue') },
  { path: '/login', name: 'login', component: () => import('../views/LoginView.vue') },
  { path: '/register', name: 'register', component: () => import('../views/RegisterView.vue') },
  { path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') },

  {
    path: '/admin',
    component: () => import('../views/admin/AdminLayout.vue'),
    meta: { requiresAdmin: true },
    children: [
      { path: '', name: 'admin-overview', component: () => import('../views/admin/Overview.vue') },
      { path: 'packages', name: 'admin-packages', component: () => import('../views/admin/Packages.vue') },
      { path: 'users', name: 'admin-users', component: () => import('../views/admin/Users.vue') },
      { path: 'failed', name: 'admin-failed', component: () => import('../views/admin/FailedAttempts.vue') },
      { path: 'audit', name: 'admin-audit', component: () => import('../views/admin/AuditLog.vue') },
    ],
  },

  { path: '/:pathMatch(.*)*', redirect: '/' },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  if (to.meta.requiresAdmin) {
    const token = getToken();
    const role = getRole();
    if (!token || role !== 'admin') {
      return { name: 'login', query: { redirect: to.fullPath, admin: '1' } };
    }
  }
  if (to.meta.requiresUser) {
    const token = getToken();
    const role = getRole();
    if (!token || role !== 'user') {
      return { name: 'login', query: { redirect: to.fullPath } };
    }
  }
  return true;
});

export default router;

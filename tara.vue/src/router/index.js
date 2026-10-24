import { createRouter, createWebHistory } from 'vue-router'
import MainPage from '@/views/MainPage.vue'
import DiagramView from '@/views/DiagramView.vue'
import FeaturePlaceholderView from '@/views/FeaturePlaceholderView.vue'
import { requireDiagram } from './guards.js'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'MainPage', component: MainPage },
    { path: '/edit-diagram/:title', name: 'EditDiagram', component: DiagramView },
    {
      path: '/dashboard',
      name: 'Dashboard',
      component: FeaturePlaceholderView,
      props: { title: 'Dashboard' },
    },
    {
      path: '/mitre-admin',
      name: 'MitreAdmin',
      component: FeaturePlaceholderView,
      props: { title: 'MITRE Admin' },
    },
  ],
})

router.beforeEach(requireDiagram)

export default router

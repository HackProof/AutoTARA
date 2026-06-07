import { createWebHistory, createRouter } from 'vue-router'

import MainPageView from '@/views/MainPage.vue'
import DiagramView from '@/views/DiagramView.vue'
import DashboardView from '@/views/DashboardView.vue'
import MitreAdminView from '@/views/MitreAdminView.vue'
import { useThreatModelStore } from "@/stores/threatModelStore.js";

const routes = [
    { path: '/', component: MainPageView, name: 'MainPage' },
    {
        path: '/edit-diagram/:title',
        component: DiagramView,
        name: 'EditDiagram',
        beforeEnter: (to, from, next) => {
            const tmStore = useThreatModelStore()
            const title = tmStore.data.modelInfo.title

            if (title !== to.params.title || title === '') {
                alert('Error: Threat Model not loaded. Please load a Threat Model first.')
                next({ name: 'MainPage' })
                return
            }

            next()
        }
    },
    { path: '/dashboard', component: DashboardView, name: 'Dashboard' },
    { path: '/mitre-admin', component: MitreAdminView, name: 'MitreAdmin' }
]

const router = createRouter({
    history: createWebHistory(),
    routes,
})

export default router

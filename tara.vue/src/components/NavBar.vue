<script setup>
import logoUrl from '@/assets/auto-tara-logo.png'
</script>

<template>
  <nav class="navbar navbar-expand-lg bg-body-tertiary" aria-label="Main navigation">
    <div class="container-fluid">
      <RouterLink class="navbar-brand" :to="{ name: 'MainPage' }">
        <img :src="logoUrl" alt="Logo" width="30" class="d-inline-block align-text-top" />
        AutoTARA
      </RouterLink>
      <button
        v-if="false"
        class="navbar-toggler"
        type="button"
        data-bs-toggle="collapse"
        data-bs-target="#navbarNavAltMarkup"
        aria-controls="navbarNavAltMarkup"
        aria-expanded="false"
        aria-label="Toggle navigation"
      >
        <span class="navbar-toggler-icon"></span>
      </button>
      <div v-if="false" id="navbarNavAltMarkup" class="collapse navbar-collapse">
        <div class="navbar-nav ms-auto">
          <RouterLink class="nav-link" :to="{ name: 'Dashboard' }">Dashboard</RouterLink>
          <RouterLink class="nav-link" :to="{ name: 'MitreAdmin' }">MITRE Admin</RouterLink>
        </div>
      </div>
    </div>
  </nav>
</template>

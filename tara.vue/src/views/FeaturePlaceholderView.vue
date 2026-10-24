<script setup>
defineProps({ title: { type: String, required: true } })
</script>

<template>
  <section class="container py-5">
    <h1 class="h3">{{ title }}</h1>
    <p class="text-body-secondary">This page is coming soon.</p>
    <RouterLink class="btn btn-outline-secondary" :to="{ name: 'MainPage' }">
      Back to Home
    </RouterLink>
  </section>
</template>

<template>
  <nav class="navbar navbar-expand-lg bg-body-tertiary">
    <div class="container-fluid">
      <router-link class="navbar-brand" :to="{ name: 'MainPage' }">
        <img src="../assets/auto-tara-logo-2.png" alt="Logo" width="30" class="d-inline-block align-text-top">
        AutoTARA
      </router-link>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNavAltMarkup" aria-controls="navbarNavAltMarkup" aria-expanded="false" aria-label="Toggle navigation">
        <span class="navbar-toggler-icon"></span>
      </button>
      <div class="collapse navbar-collapse" id="navbarNavAltMarkup">
        <div class="navbar-nav ms-auto">
          <router-link class="nav-link" :to="{ name: 'Dashboard' }">
            Dashboard
          </router-link>
          <router-link class="nav-link" :to="{ name: 'MitreAdmin' }">
            MITRE Admin
          </router-link>
        </div>
      </div>
    </div>
  </nav>
</template>

<script>

</script>

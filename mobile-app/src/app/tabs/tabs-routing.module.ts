import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { TabsPage } from './tabs.page';

const routes: Routes = [
  {
    path: 'tabs',
    component: TabsPage,
    children: [
      {
        path: 'dashboard',
        loadChildren: () => import('../tab1/tab1.module').then((m) => m.Tab1PageModule),
      },
      {
        path: 'metrics',
        loadChildren: () => import('../tab2/tab2.module').then((m) => m.Tab2PageModule),
      },
      {
        path: 'seguimiento',
        loadChildren: () => import('../tab4/tab4.module').then((m) => m.Tab4PageModule),
      },
      {
        path: 'assistant',
        loadChildren: () => import('../tab5/tab5.module').then((m) => m.Tab5PageModule),
      },
      {
        path: 'profile',
        loadChildren: () => import('../tab3/tab3.module').then((m) => m.Tab3PageModule),
      },
      {
        path: '',
        redirectTo: '/tabs/dashboard',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '',
    redirectTo: '/tabs/dashboard',
    pathMatch: 'full',
  },
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
})
export class TabsPageRoutingModule {}

import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';   // ActivatedRoute = details about the url that opened this component
import { Navbar } from '../navbar/navbar';
import { GroupService, Group, Channel } from '../group';

@Component({
  selector: 'app-group-view',
  imports: [Navbar, RouterLink],
  templateUrl: './group-view.html',
  styleUrl: './group-view.css',
})
export class GroupView {
  private groupService = inject(GroupService);
  private route = inject(ActivatedRoute);

  // signals, because this app is zoneless. angular only knows to redraw when a signal changes,
  // so setting a plain property inside a subscribe would leave the page showing nothing.
  groups = signal<Group[]>([]);            // every group, used for the sidebar down the left
  group = signal<Group | undefined>(undefined);   // just the one whose id is in the url, shown in the banner
  channels = signal<Channel[]>([]);        // the rooms inside that group

  constructor() {
    // paramMap is subscribed to rather than read once, because clicking a different group in
    // the sidebar reuses this same component and only changes the :id. a one off read wouldn't rerun.
    this.route.paramMap.subscribe(params => {
      const groupId = params.get('id') ?? '';
      this.loadGroup(groupId);
    });
  }

  private loadGroup(groupId: string) {
    this.groupService.getGroups().subscribe(groups => {   // fill the sidebar, and pick out the one being viewed
      this.groups.set(groups);
      this.group.set(groups.find(g => g.id === groupId));
    });

    this.groupService.getChannels(groupId).subscribe(channels => {
      this.channels.set(channels);
    });
  }
}

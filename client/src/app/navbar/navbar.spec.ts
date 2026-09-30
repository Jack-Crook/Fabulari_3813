import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { Router } from '@angular/router';

import { Navbar } from './navbar';
import { testProviders, signIn, signOut, makeGroup } from '../testing';

describe('Navbar', () => {
  let fixture: ComponentFixture<Navbar>;
  let mock: HttpTestingController;

  // the navbar reads the signed in user in its field initialisers, so who is signed in has to
  // be decided before the component is built rather than after
  async function build() {
    fixture = TestBed.createComponent(Navbar);
    mock = TestBed.inject(HttpTestingController);
    await fixture.whenStable();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Navbar],
      providers: testProviders(),
    }).compileComponents();
    signOut();
  });

  afterEach(() => signOut());

  it('should create', async () => {
    signIn('member@test.com');
    await build();
    mock.expectOne('http://localhost:3000/groups').flush([]);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('shows the Super Admin link only to the super admin', async () => {
    signIn('boss@test.com', 'super');
    await build();
    mock.expectOne('http://localhost:3000/groups').flush([]);
    await fixture.whenStable();

    // super admin authority is system wide rather than tied to one group, so the link is
    // always there for them rather than depending on which page they're on
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Super Admin');
  });

  it('hides the Super Admin link from an ordinary user', async () => {
    signIn('member@test.com', 'user');
    await build();
    mock.expectOne('http://localhost:3000/groups').flush([]);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Super Admin');
  });

  it('hides the Group Admin link when the url is not a group page', async () => {
    signIn('admin@test.com');
    await build();
    mock.expectOne('http://localhost:3000/groups').flush([makeGroup()]);

    // it's a computed over the group in the url. no group in the url, no link, even for
    // someone who admins a group elsewhere.
    expect(fixture.componentInstance.currentGroupId()).toBe('');
    expect(fixture.componentInstance.isGroupAdmin()).toBe(false);
  });

  it('shows the Group Admin link on a group this user admins', async () => {
    signIn('admin@test.com');
    await build();
    mock.expectOne('http://localhost:3000/groups').flush([makeGroup()]);

    // group admin isn't a role on the account, it's whether this email is in that group's
    // adminEmails, which is why the check needs the group as well as the user
    fixture.componentInstance.currentGroupId.set('g1');
    expect(fixture.componentInstance.isGroupAdmin()).toBe(true);
  });

  it('does not show it to a plain member of that same group', async () => {
    signIn('member@test.com');
    await build();
    mock.expectOne('http://localhost:3000/groups').flush([makeGroup()]);

    fixture.componentInstance.currentGroupId.set('g1');
    expect(fixture.componentInstance.isGroupAdmin()).toBe(false);
  });

  // the account menu replaced the name, Profile and Logout that used to sit on the bar itself

  it('shows the initial in the avatar and keeps the menu closed until it is clicked', async () => {
    signIn('member@test.com', 'user', 'jack');
    await build();
    mock.expectOne('http://localhost:3000/groups').flush([]);
    await fixture.whenStable();

    const page = fixture.nativeElement as HTMLElement;
    const button = page.querySelector('.account-button') as HTMLButtonElement;
    expect(page.querySelector('.nav-avatar')?.textContent?.trim()).toBe('J');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(page.querySelector('.account-menu')).toBeNull();

    button.click();
    await fixture.whenStable();

    expect(button.getAttribute('aria-expanded')).toBe('true');
    const menu = page.querySelector('.account-menu')!;
    expect(menu.textContent).toContain('jack');
    expect(menu.textContent).toContain('member@test.com');
    expect(menu.textContent).toContain('Profile');
    expect(menu.textContent).toContain('Logout');
  });

  it('closes the menu on Escape and on a click outside the navbar', async () => {
    signIn('member@test.com');
    await build();
    mock.expectOne('http://localhost:3000/groups').flush([]);
    const navbar = fixture.componentInstance;

    navbar.toggleMenu();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(navbar.menuOpen()).toBe(false);

    navbar.toggleMenu();
    document.body.click();          // the body is outside the navbar's own element
    expect(navbar.menuOpen()).toBe(false);
  });

  it('logs out from the menu and goes back to the login page', async () => {
    signIn('member@test.com');
    await build();
    mock.expectOne('http://localhost:3000/groups').flush([]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

    fixture.componentInstance.onLogout();

    expect(localStorage.getItem('user')).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpTestingController } from '@angular/common/http/testing';

import { Router } from '@angular/router';

import { Navbar } from './navbar';
import { testProviders, signIn, signOut, makeGroup } from '../testing';

describe('Navbar', () => {
  let fixture: ComponentFixture<Navbar>;
  let mock: HttpTestingController;

  // sign in before the component is built, it reads the user straight away
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

    // super admin is system wide, so the link is always there
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

    // no group in the url, no link
    expect(fixture.componentInstance.currentGroupId()).toBe('');
    expect(fixture.componentInstance.isGroupAdmin()).toBe(false);
  });

  it('shows the Group Admin link on a group this user admins', async () => {
    signIn('admin@test.com');
    await build();
    mock.expectOne('http://localhost:3000/groups').flush([makeGroup()]);

    // group admin is stored on the group, so the check needs the group too
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

  // the account menu holds the name, Profile and Logout

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

  it('shows the uploaded profile picture instead of the initial', async () => {
    localStorage.setItem('user', JSON.stringify({
      email: 'member@test.com', role: 'user', username: 'jack', avatarUrl: '/uploads/me.png',
    }));
    await build();
    mock.expectOne('http://localhost:3000/groups').flush([]);
    await fixture.whenStable();

    const avatar = (fixture.nativeElement as HTMLElement).querySelector('img.nav-avatar');
    expect(avatar?.getAttribute('src')).toBe('http://localhost:3000/uploads/me.png');
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
    document.body.click();          // outside the navbar
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

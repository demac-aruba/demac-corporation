import type { Asset, Contact, Customer, Site } from '../domain';
import { collections } from '../data-schema';
import type { AuthPrincipal } from '../security';
import { FirebaseDocumentRepository } from './repository';

export type CustomerGraph = {
  customer: Customer;
  contacts: Contact[];
  sites: Site[];
  assets: Asset[];
};

export function createFirebaseCrmRepositories(principal: () => AuthPrincipal) {
  const customers = new FirebaseDocumentRepository<Customer>({ collection: collections.customers, idPrefix: 'cus', principal });
  const contacts = new FirebaseDocumentRepository<Contact>({ collection: collections.contacts, idPrefix: 'con', principal });
  const sites = new FirebaseDocumentRepository<Site>({ collection: collections.sites, idPrefix: 'sit', principal });
  const assets = new FirebaseDocumentRepository<Asset>({ collection: collections.assets, idPrefix: 'ast', principal });

  return { customers, contacts, sites, assets };
}

export class FirebaseCustomerGraphRepository {
  private readonly repositories;

  constructor(private readonly principal: () => AuthPrincipal) {
    this.repositories = createFirebaseCrmRepositories(principal);
  }

  async listCustomers() {
    return (await this.repositories.customers.list({ limit: 500 })).items;
  }

  async loadCustomerGraph(customerId: string): Promise<CustomerGraph | null> {
    const customer = await this.repositories.customers.getById(customerId);
    if (!customer) return null;
    const [contacts, sites, assets] = await Promise.all([
      this.repositories.contacts.list({ limit: 500 }),
      this.repositories.sites.list({ limit: 500 }),
      this.repositories.assets.list({ limit: 500 }),
    ]);
    return {
      customer,
      contacts: contacts.items.filter((item) => item.customerId === customerId),
      sites: sites.items.filter((item) => item.customerId === customerId),
      assets: assets.items.filter((item) => item.customerId === customerId),
    };
  }

  customerRepository() { return this.repositories.customers; }
  contactRepository() { return this.repositories.contacts; }
  siteRepository() { return this.repositories.sites; }
  assetRepository() { return this.repositories.assets; }
}

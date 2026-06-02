# LetsCook Changelog

## 0.9.1

- Audit je prebačen u tablicu s filtrima po stupcima i sortiranjem.
- Svaka radnja sada nosi detalje po ID-u za lakše praćenje u bazi.
- Audit prikazuje i preglednik te operativni sustav za prijave i goste.

## 0.9.0

- Backupovi se sada spremaju na server i ostaju dostupni u povijesti.
- Može se podesiti raspored backupova i broj zadržanih kopija.
- Upravljanje sada prikazuje audit zapise i log gostujućih zahtjeva.
- Korisnici u listi sada prikazuju i vrijeme zadnje prijave.

## 0.8.4

- Uvezeni recepti više ne prikazuju izmišljene porcije, vrijeme i težinu.
- Recepti bez težine sada uvijek idu na kraj kod sortiranja po kompleksnosti.
- U editoru se prazna polja za porcije, vrijeme i kompleksnost više ne popunjavaju lažnim vrijednostima.

## 0.8.3

- Izbornici u headeru sada se automatski zatvaraju klikom izvan njih.
- Otvaranje filter izbornika sada radi pouzdano.

## 0.8.2

- Odabir jezika u headeru sada prikazuje samo zastavu, a izbornik prikazuje i nazive jezika.
- Filteri su premješteni u izbornik s prikazom, opsegom recepata, sortiranjem i smjerom.
- Search polje sada ostaje desno od filter ikone u kompaktnom retku.

## 0.8.1

- Filter Svi recepti sada je kompaktniji odabir i zauzima manje mjesta.
- Odabir jezika sada prikazuje zastavu i naziv jezika.
- Na prikazu recepta sastojci su premješteni prije pripreme.

## 0.8.0

- Aplikacija sada ima kompaktniji gornji header prilagođen mobitelima.
- Glavni meni se otvara preko ikone s tri crte, a jezik i korisnički meni su desno.
- Pretraga, filteri i odabir prikaza recepata nalaze se u jednom retku ispod headera.

## 0.7.0

- Superadmin sada može preuzeti ZIP backup svih recepata s Markdown datotekama i slikama.
- Administratori mogu trajno obrisati recept kada je to potrebno.
- Upravljanje korisnicima sada uključuje blokiranje, promjenu lozinke i pregled recepata po korisniku.

## 0.6.3

- Slika gotovog jela više se ne ponavlja na početku pripreme ako je već prikazana iznad recepta.
- Upute u editoru sada jasnije objašnjavaju gdje staviti glavnu sliku i slike pripreme.
- Prikaz pripreme i pozicija sastojaka pri skrolanju su pregledniji.

## 0.6.2

- U editoru recepta uklonjeno je nenamjerno dupliciranje postojećih slika.
- Klik u tekst postupka više ne aktivira umetanje slike.
- Postupak u editoru sada je odvojen od HTML label kontrole radi stabilnijeg fokusa.

## 0.6.1

- Slika koja je već prikazana iznad recepta više se ne ponavlja u pripremi.
- Slike u receptu ograničene su na pregledniju veličinu.
- Editor recepta stabilnije radi nakon umetanja slike.

## 0.6.0

- Editor postupka sada koristi novi WYSIWYG editor.
- U editoru se tekst uređuje direktno, a recept se i dalje sprema kao Markdown.
- Sastojci na pregledu recepta ostaju niže ispod zaglavlja pri skrolanju.

## 0.5.0

- Novi korisnici se sada mogu registrirati kroz aplikaciju.
- Nakon registracije korisnik je odmah prijavljen.
- Registracija provjerava email, ime i minimalnu duljinu lozinke.

## 0.4.3

- Editor postupka je zamijenjen stabilnijim editorom bez dupliciranja slika.
- Toolbar editora je jednostavniji i pouzdano klikabilan.
- Ikona neprijavljenog korisnika sada je siva.

## 0.4.2

- Aplikacija sada sama osvježava stranicu kada je dostupna nova verzija.
- Gornji desni izbornik je kompaktniji i bolje poravnat.
- Sastojci na receptu prikazuju se preglednije u jednom retku.

## 0.4.1

- Popravljeno je dupliciranje slike pri kliku na sliku u editoru postupka.
- Toolbar editora bolje se prelama i tipke više ne izlaze iz svog prostora.
- Editor i zaglavlje se stabilnije prilagođavaju pri smanjivanju prozora.

## 0.4.0

- Administratori sada mogu pregledavati korisnike u Upravljanju.
- Administratori mogu mijenjati korisničke uloge u skladu s pravilima ovlasti.
- Administratori mogu blokirati i odblokirati korisnike.

## 0.3.1

- Ispravljeno je cacheiranje podataka o verziji kako browser ne bi ostao na staroj verziji.
- Dodano je pravilo da se ubuduće verzija predloži prije commita.

## 0.3.0

- Popravljeno je popunjavanje polja kod uređivanja recepta.
- U editoru postupka više nema glavnog naslova; koriste se Naslov i Podnaslov.
- Aplikacija sada javlja kada je dostupna novija verzija i nudi osvježavanje.

## 0.2.7

- Prva slika iz teksta recepta sada se koristi kao glavna slika na listi i na receptu.
- Kod uređivanja recepta postojeće slike se mogu brzo umetnuti na početak postupka.
- Gornja polja editora su zbijena i jasnije označena za brže popunjavanje.

## 0.2.6

- Editor recepta sada koristi WYSIWYG Markdown i sprema postupak kao Markdown.
- Slike se u editoru učitavaju kroz aplikaciju i automatski umeću u postupak.
- Prikaz postupka recepta pretvara Markdown u siguran web prikaz.

## 0.2.5

- Gumb za sviđanje recepta sada je na hrvatskom: Sviđa mi se.
- Changelog je izdvojen u poseban prikaz koji se otvara u novom tabu.

## 0.2.4

- Dodano je Upravljanje za provjeru novih recepata.
- Pregled recepata sada ima jednostavan izbor: Svi, Moji ili Omiljeni.
- Novi recepti su vidljivi odmah, ali čekaju provjeru moderatora.

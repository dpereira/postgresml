---
author: Lev Kokotov
description: Addressing horizontal scalability concerns, we've benchmarked PostgresML and ended up with an incredible 1 million requests per second using commodity hardware.
image: https://static.postgresml.org/benchmarks/Slow-Down-Sign.jpg
image_alt: PostgresML at 1 million requests per second
---

# Scaling PostgresML to 1 Million Requests per Second

<p class="author">
  <img width="54px" height="54px" src="/images/team/lev.jpg" alt="Author" />
  Lev Kokotov<br/>
  November 7, 2022
</p>

The question "Does it Scale?" has become somewhat of a meme in software engineering. There is a good reason for it though, because most businesses plan for success. If your app, online store, or SaaS takes off, you want to be sure that the system powering it can serve all your customers.

At PostgresML, we are very concerned with scale. Our engineering background took us through scaling OLTP and OLAP Postgres to 100 TB+, so we're certain that Postgres scales, but could we scale machine learning alongside it?

In this post, we'll discuss some challenges facing machine learning inference with PostgresML, and how we solved them to achieve an impressive **1 million XGBoost predictions per second** on commodity hardware.

If you missed our previous post and are wondering why someone would combine machine learning and Postgres, take a look at our PostgresML vs. Python [benchmark](/blog/postgresml-is-8x-faster-than-python-http-microservices).


## An Image Worth Four Thousand Words

Our thesis, and the reason why we chose Postgres as our host for machine learning, is that scaling machine learning inference is very similar to scaling read queries in a typical database cluster.

Inference speed varies based on the model complexity (e.g. `n_estimators` for XGBoost) and the size of the dataset (how many features the model uses), which is analogous to query complexity and table size in the database world. Scaling the latter is mostly a solved problem.

### System Architecture

If you're a Postgres enthusiast (or a database engineer), scaling Postgres may not be a secret to you, and you can jump straight to the [results](#results). For everyone else, here is a diagram showing the final state of our system:

<center>
![Scaling PostgresML](/images/illustrations/scaling-postgresml-3.svg) <br />
_System Architecture_
</center>

| Component | Description |
|-----------|-------------|
| Clients | Regular Postgres clients |
| ELB | [Elastic Network Load Balancer](https://aws.amazon.com/elasticloadbalancing/) |
| PgCat | A Postgres [pooler](https://github.com/levkk/pgcat/) with built-in load balancing, failover, and sharding |
| Replica | Regular Postgres [replicas](https://www.postgresql.org/docs/current/high-availability.html) |
| Primary | Regular Postgres primary |


Our architecture has four components that may need to scale up or down based on load:

1. Clients
2. Load balancer
3. [PgCat](https://github.com/levkk/pgcat/) pooler
4. Postgres replicas

We intentionally don't discuss scaling the primary in this post, because sharding, which is the most effective way to do so, is a fascinating subject that deserves its own series of posts. Spoiler alert: we sharded Postgres without any problems.

#### Clients

Clients are regular Postgres connections coming from web apps, job queues, or pretty much anywhere that needs data. They can be long-living or ephemeral and they typically grow in number as the application scales.

Most modern deployments use containers which are added as load on the app increases, and removed as the load decreases. This is called dynamic horizontal scaling, and it's an effective way to adapt to changing traffic patterns experienced by most businesses.

#### Load Balancer

The load balancer is a way to spread traffic across horizontally scalable components, by routing new connections to targets in a round robin (or random) fashion. It's typically a very large box (or a fast router), but even those need to be scaled if traffic suddenly increases. Since we're running our system on AWS, this is already taken care of, for a reasonably small fee, by using an Elastic Load Balancer.

#### PgCat

<center>
	<img src="https://raw.githubusercontent.com/levkk/pgcat/main/pgcat3.png" alt="PgCat" height="300" width="auto" /> <br />
	_Meow. All your Postgres belong to me._
</center>

If you've used Postgres in the past, you know that it can't handle many concurrent connections. For large deployments, it's necessary to run something we call a pooler. A pooler routes thousands of clients to only a few dozen server connections by time-sharing when a client can use a server. Because most queries are very quick, this is a very effective way to run Postgres at scale.

There are many poolers available presently, the most notable being PgBouncer, which has been around for a very long time, and is trusted by many large organizations. Unfortunately, it hasn't evolved much with the growing needs of highly available Postgres deployments, so we wrote [our own](https://github.com/levkk/pgcat/) which added important functionality we needed:

- Load balancing of read queries
- Failover in case a read replica is broken
- Sharding (this feature is still being developed)

In this benchmark, we used its load balancing feature to evenly distribute XGBoost predictions across our Postgres replicas.


#### Postgres Replicas

Scaling Postgres reads is a solved problem. If more read queries are coming in, add a replica to serve the increased load. If the load is decreasing, remove a replica to save money. The data is replicated from the primary, so all replicas are identical, and all of them can serve any query, or in our case, an XGBoost prediction.


## Results

We ran over a 100 different benchmarks, by changing the number of clients, poolers, replicas, and XGBoost predictions we requested. The benchmarks were meant to test the limits of each configuration, and what remediations were needed in each scenario. Our raw data is available [below](#methodology).

One of the tests we ran used 1,000 clients, which were connected to 1, 2, and 5 replicas. The results were exactly what we expected.

### Linear Scaling

<center>
	<iframe width="600" height="371" seamless frameborder="0" scrolling="no" src="https://docs.google.com/spreadsheets/d/e/2PACX-1vRm4aEylX8xMNmO-HFFxr67gbZDQ8rh_vss1HvX0tWAUD_zxkwYYNhiBObT1LVe8m6ELZ0seOzmH0ZL/pubchart?oid=2028066210&amp;format=interactive"></iframe>
</center>

<center>
	<iframe width="600" height="371" seamless frameborder="0" scrolling="no" src="https://docs.google.com/spreadsheets/d/e/2PACX-1vRm4aEylX8xMNmO-HFFxr67gbZDQ8rh_vss1HvX0tWAUD_zxkwYYNhiBObT1LVe8m6ELZ0seOzmH0ZL/pubchart?oid=1442564288&amp;format=interactive"></iframe>
</center>

Both latency and throughput, the standard measurements of system performance, scale mostly linearly with the number of replicas. Linear scaling is the north star of all horizontally scalable systems, and most are not able to achieve it because of increasing complexity that comes with synchronization.

Our architecture shares nothing and requires no synchronization. The replicas don't talk to each other and the poolers don't either. Every component has the knowledge it needs (through configuration) to do its job, and they do it well.

The most impressive result is serving close to a million predictions with an average latency of less than 1ms. You might notice though that `950160.7` isn't quite one million, and that's true. We couldn't reach one million with 1000 clients, so we increased to 2000 and got our magic number: **1,021,692.7 req/sec**, with an average latency of **1.7ms**.


### Batching Predictions

Batching is a proven method to optimize performance. If you need to get several data points, batch the requests into one query, and it will run faster than making individual requests.

We should precede this result by stating that PostgresML does not yet have a batch prediction API as such. Our `pgml.predict()` function can predict multiple points, but we haven't implemented a query pattern to pass multiple Postgres rows to that function at the same time. Once we do, based on our tests, we should see a quadratic increase in performance.

Regardless of that limitation, we still managed to get better results by batching queries together since Postgres needed to do less query parsing and data fetching, and we saved on network round trip time as well.

<center>
	<iframe width="600" height="371" seamless frameborder="0" scrolling="no" src="https://docs.google.com/spreadsheets/d/e/2PACX-1vRm4aEylX8xMNmO-HFFxr67gbZDQ8rh_vss1HvX0tWAUD_zxkwYYNhiBObT1LVe8m6ELZ0seOzmH0ZL/pubchart?oid=1506211879&amp;format=interactive"></iframe>
</center>

<center>
	<iframe width="600" height="371" seamless frameborder="0" scrolling="no" src="https://docs.google.com/spreadsheets/d/e/2PACX-1vRm4aEylX8xMNmO-HFFxr67gbZDQ8rh_vss1HvX0tWAUD_zxkwYYNhiBObT1LVe8m6ELZ0seOzmH0ZL/pubchart?oid=1488435965&amp;format=interactive"></iframe>
</center>

If batching did not work at all, we would see a linear increase in latency and a linear decrease in throughput. That did not happen; instead, we got a good increase in throughput and a sublinear increase in latency. A modest success, but a success nonetheless.

### Graceful Degradation and Queuing

<center>
	<iframe width="600" height="371" seamless frameborder="0" scrolling="no" src="https://docs.google.com/spreadsheets/d/e/2PACX-1vRm4aEylX8xMNmO-HFFxr67gbZDQ8rh_vss1HvX0tWAUD_zxkwYYNhiBObT1LVe8m6ELZ0seOzmH0ZL/pubchart?oid=1396205706&amp;format=interactive"></iframe>
</center>

<center>
	<iframe width="600" height="371" seamless frameborder="0" scrolling="no" src="https://docs.google.com/spreadsheets/d/e/2PACX-1vRm4aEylX8xMNmO-HFFxr67gbZDQ8rh_vss1HvX0tWAUD_zxkwYYNhiBObT1LVe8m6ELZ0seOzmH0ZL/pubchart?oid=1300503904&amp;format=interactive"></iframe>
</center>

All systems, at some point in their lifetime, will come under more load than they were designed for; what happens then is an important feature (or bug) of their design. Horizontal scaling is never immediate: it takes a bit of time to spin up additional hardware to handle the load. It can take a second, or a minute, depending on availability, but in both cases, existing resources need to serve traffic the best way they can.

We were hoping to test PostgresML to its breaking point, but we couldn't quite get there. As load (number of clients) increased beyond provisioned capacity, the only thing we saw was a gradual increase in latency. Throughput remained roughly the same. This gradual latency increase was caused by simple queuing: the replicas couldn't serve requests concurrently, so the requests had to patiently wait in the poolers.

<center>
	![Queuing](/images/illustrations/queueing.svg) <br />
	_"What's taking so long over there!?"_
</center>

Among many others, this is a very important feature of any proxy: it's a FIFO queue (first in, first out). If the system is underutilized, queue size is 0 and all requests are served as quickly as physically possible. If the system is overutilized, the queue size increases, holds as the number of requests stabilizes, and decreases back to 0 as the system is scaled up to accommodate new traffic.

Queueing overall is not desirable, but it's a feature, not a bug. While autoscaling spins up an additional replica, the app continues to work, although a few milliseconds slower, which is a good trade off for not overspending on hardware.

As the demand on PostgresML increases, the system gracefully handles the load. If the number of replicas stays the same, latency slowly increases, all the while remaining well below acceptable ranges. Throughput holds as well, as increasing number of clients evenly split available resources.

If we increase the number of replicas, latency decreases and throughput increases and eventually stabilizies as the number of clients increases in parallel. We get the best result with 5 replicas, but this number is variable and can be changed as needs for latency compete with cost.


## What's Next

Horizontal scaling and high availability are fascinating topics in software engineering. After doing this benchmark, we had no more doubts about our chosen architecture. Needing to serve 1 million predictions per second is rare, but having the ability to do that, and more if desired, is an important aspect for any new system.

The next challenge for us is to scale writes horizontally. In the database world, this means sharding the database into multiple separate machines using a hashing function, and automatically routing both reads and writes to the right shards. There are many possible solutions on the market for this already, e.g. Citus and Foreign Data Wrappers, but none are as horizontally scalable as we like, although we will incorporate them into our architecture until we build the one we really want.

For that purpose, we're building our own open source [Postgres proxy](https://github.com/levkk/pgcat/) which we discussed earlier in the article. As we progress further in our journey, we'll be adding more features and performance improvements.

By combining PgCat with PostgresML, we are aiming to build the next generation of machine learning infrastructure that can power anything from two-person startups, like us, to unicorns and massive enterprises, without the data ever leaving our favorite database.


## Methodology

### ML

This time, we used an XGBoost model with 100 trees

```postgresql
SELECT * FROM pgml.train(
	'flights',
	task => 'regression',
	relation_name => 'flights_mat_3',
	y_column_name => 'depdelayminutes',
	algorithm => 'xgboost',
	hyperparams => '{"n_estimators": 100 }',
	runtime => 'rust'
);
```

and fetched our predictions the usual way

```postgresql
SELECT pgml.predict(
	'flights',
	ARRAY[
		year,
		quarter,
		month,
		distance,
		dayofweek,
		dayofmonth,
		flight_number_operating_airline,
		originairportid,
		destairportid,
		flight_number_marketing_airline,
		departure
	]
) AS prediction
FROM flights_mat_3 LIMIT :limit;
```

where `:limit` is the batch size of 1, 5, and 20, depending on the benchmark.

#### Model

The model is roughly the same as the one we used in our previous [post](/blog/postgresml-is-8x-faster-than-python-http-microservices), with just one extra feature added, which improved R<sup>2</sup> a little bit.

### Hardware

#### Client
The client was a `c5n.4xlarge` box on EC2. We chose the `c5n` class to have the 100 GBit NIC, since we wanted it to saturate our network as much as possible. Thousands of clients were simulated using [`pgbench`](https://www.postgresql.org/docs/current/pgbench.html) with `-c n` where `n` is the number of clients.

#### PgCat Pooler
PgCat, written in asynchronous Rust, was running on `c5.xlarge` machines (4 vCPUs, 8GB RAM) with 4 Tokio workers. We used between 1 and 35 machines, and scaled them in increments of 5-20 at a time.

The pooler did a decent amount of work around parsing queries, making sure they are read-only `SELECT`s, and routing them, at random, to replicas. If any replica was down for any reason, it would route around it to remaining machines.

#### Postgres Replicas
Postgres replicas were running on `c5.9xlarge` machines with 36 vCPUs and 72 GB of RAM. The hot dataset fits entirely in memory. The servers were intentionally saturated to maximum capacity before scaling up to test queuing and graceful degradation of performance.


#### Raw Results

Raw latency data is available [here](https://static.postgresml.org/benchmarks/reads-latency.csv) and raw throughput data is available [here](https://static.postgresml.org/benchmarks/reads-throughput.csv).

## Feedback

Many thanks and ❤️ to all those who are supporting this endeavor. We’d love to hear feedback from the broader ML and Engineering community about applications and other real world scenarios to help prioritize our work. You can show your support by starring us on our [Github](https://github.com/postgresml/postgresml/).


## We're Hiring!

[PostgresML](https://github.com/postgresml/postgresml/) and [PgCat](https://github.com/levkk/pgcat/) are free and open source, and to support their development, and many more things we're building, we started a company. We're only a few months old, and we have raised enough funding to say, for the first time ever: we're hiring!

We're looking for software engineers interested in machine learning, solving big problems, databases, and anything in between. Don't hesitate to reach out to <a href="mailto:team@postgresml.org">team@postgresml.org</a> or in [Discord](https://discord.gg/DmyJP3qJ7U).

## Call to Early Adopters

If your organization can benefit from simplified and fast machine learning, get in touch! We can help deploy PostgresML internally, and collaborate on new and existing features. Join our [Discord](https://discord.gg/DmyJP3qJ7U) or [email](mailto:team@postgresml.org) us!


